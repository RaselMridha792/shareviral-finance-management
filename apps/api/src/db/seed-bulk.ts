/**
 * A hundred of everything, on two accounts.
 *
 *   npm run db:bulk -- reset   clear the sample data, then load it fresh
 *   npm run db:bulk            load on top of what is there
 *   npm run db:bulk -- wipe    clear it and stop
 *   npm run db:bulk -- dry     build every row, write none — check the counts
 *
 * `seed-demo.ts` tells a small, coherent story — one July, one August, a
 * handful of rows. That is the right thing for a first look and the wrong
 * thing for checking a screen that only pages past twenty. This is the other
 * one: volume, in every table that can hold it, so a second page exists to
 * click to and a total has something to be wrong about.
 *
 * ---------------------------------------------------------------------------
 * Two accounts, and only two
 * ---------------------------------------------------------------------------
 * Master card and Standard Chartered Bank. Everything else was removed at the
 * owner's request, and this file will not recreate them — `wipe` deletes any
 * account that is not one of those two, and `load` refuses to invent more. If
 * a third account is ever wanted, add it on the Accounts screen; a seeder that
 * quietly re-adds five banks every time it runs is how the list got long in
 * the first place.
 *
 * Both accounts' opening balances are left exactly as they are. Their opening
 * *date* is moved back to the start of the ledger window, because a running
 * balance is the opening figure plus everything since, and entries dated
 * before it make every balance above them disagree with itself.
 *
 * ---------------------------------------------------------------------------
 * What it does not touch
 * ---------------------------------------------------------------------------
 * The five real sign-ins at `@shareviral.cash`, their sessions, the audit log,
 * the settings row, and the FY2026 tax policy. Those are the parts somebody
 * would have to rebuild by hand.
 *
 * ---------------------------------------------------------------------------
 * Deliberately deterministic
 * ---------------------------------------------------------------------------
 * A seeded generator rather than Math.random, so two runs produce the same
 * figures and "the total changed" is a finding rather than the seeder. Row ids
 * are real UUIDs and so differ between runs; every amount, date and name does
 * not.
 */

import { createHash, randomUUID } from "node:crypto";

import { slugify } from "@finance/shared";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { seal } from "../common/crypto/secret-box";
import { poolOptionsFor } from "./connection";
import * as schema from "./schema";
import {
  accounts,
  aiAttachments,
  aiChats,
  aiCorrections,
  categories,
  compensationHistory,
  files,
  fxRates,
  importBatches,
  importRows,
  incomeTaxRecords,
  notificationLog,
  notifications,
  payrollLines,
  payrollRuns,
  recoveryCodes,
  statements,
  subscriptionUsers,
  subscriptions,
  taxPolicies,
  taxPolicyBands,
  tdsAllocations,
  tdsDeposits,
  teamMembers,
  transactions,
  userTwoFactor,
  users,
  vendors,
  withholdingReturns,
} from "./schema";

/**
 * Reads the .env files when they are there, and shrugs when they are not.
 *
 * This script has two homes and they disagree about how it learns the
 * connection string. On a laptop it is `apps/api/.env` and `dotenv` reads it.
 * In the production image the variables are already in the environment —
 * compose put them there — and `dotenv` is not installed at all, because it is
 * a dev dependency and the image runs `npm prune --omit=dev`.
 *
 * So a plain top-level `import ... from "dotenv"` would work here and crash on
 * the server, which is the worst possible place to find out. It resolves today
 * only because `@nestjs/config` happens to depend on it; that is somebody
 * else's dependency and not a promise to us.
 */
function loadEnvFiles(): void {
  try {
    /* eslint-disable-next-line @typescript-eslint/no-require-imports */
    const dotenv = require("dotenv") as {
      config: (options: { path: string }) => void;
    };
    dotenv.config({ path: ".env.local" });
    dotenv.config({ path: ".env" });
  } catch {
    // No dotenv, or no files. Either way the environment is already set.
  }
}

loadEnvFiles();

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set.\n" +
      "  On a laptop:   put it in apps/api/.env\n" +
      "  On the server: run this inside the api container, which already has it.",
  );
  process.exit(1);
}

const pool = new Pool(poolOptionsFor(url));
const db = drizzle(pool, { schema });

/** The tag the story seeder uses too, so one wipe clears both. */
const TAG = "[demo]";

/** Aim above the hundred that was asked for, so a filter can hide some. */
const TARGET = 120;

/** The two that stay. Compared lower-cased, like the unique index does. */
const KEEP_ACCOUNTS = ["master card", "standard chartered bank"];

/**
 * The address this file gives the sign-ins it creates, and the only ones the
 * wipe deletes.
 *
 * It was the other way round — "delete anything that is not @shareviral.cash"
 * — which is a rule about who is *not* real, and it was wrong on the live
 * database, where the super admin signs in as a gmail address. That wipe would
 * have taken the owner's own account with it, and `users` cascades: the
 * sessions, the two-factor enrolment and the forty recovery codes behind it
 * would have gone in the same statement.
 *
 * Naming what this file made is the safer direction. A real person is anyone
 * this file did not create, whatever they signed up as, and no future address
 * can accidentally fall outside the pattern and be deleted.
 */
const SAMPLE_USERS = "%@demo.sharevirals.test";

/** Rows go in in batches; one round trip per row would take a quarter hour. */
const CHUNK = 250;

/**
 * `dry` builds every row and writes none of them.
 *
 * Worth having rather than trusting the counts: this file loads onto a live
 * database, and the cheapest place to find out that a table came out at
 * ninety-four is before the wipe, not after it.
 */
const DRY = process.argv[2] === "dry";

/* -------------------------------------------------------------------------- */
/*  Deterministic randomness                                                    */
/* -------------------------------------------------------------------------- */

let seed = 20260820;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
const pick = <T>(list: readonly T[]): T =>
  list[Math.floor(rnd() * list.length)];
const between = (lo: number, hi: number) => Math.floor(rnd() * (hi - lo)) + lo;
/** A round-ish figure in taka, given a range in hundreds. */
const money = (lo: number, hi: number) => (between(lo, hi) * 100).toFixed(2);
const maybe = (chance: number) => rnd() < chance;

/* -------------------------------------------------------------------------- */
/*  Dates                                                                       */
/* -------------------------------------------------------------------------- */

/** Fixed, not `new Date()` — a seeder that drifts with the clock is not one. */
const TODAY = new Date(Date.UTC(2026, 7, 20));
/** The ledger window: two years of entries, ending today. */
const WINDOW_MONTHS = 24;

const iso = (d: Date) => d.toISOString().slice(0, 10);

function dayBefore(days: number): string {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() - days);
  return iso(d);
}

/** First day of the month `back` months before August 2026. */
const monthStart = (back: number) => new Date(Date.UTC(2026, 7 - back, 1));
/** Last day of the same month. */
const monthEnd = (back: number) => new Date(Date.UTC(2026, 8 - back, 0));
/** A day inside that month, never past today. */
function dayIn(back: number, day: number): string {
  const end = monthEnd(back);
  const wanted = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), day),
  );
  const capped = wanted > end ? end : wanted;
  return iso(capped > TODAY ? TODAY : capped);
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** What a dollar was worth on a given day. Wobbles, never jumps. */
function usdRateOn(date: string): string {
  const days = Math.round(
    (TODAY.getTime() - new Date(`${date}T00:00:00Z`).getTime()) / 86_400_000,
  );
  return (121.5 - days * 0.004 + Math.sin(days / 9) * 0.6).toFixed(6);
}

/* -------------------------------------------------------------------------- */
/*  Name pools                                                                  */
/* -------------------------------------------------------------------------- */

const FIRST_NAMES = [
  "Arif",
  "Nusrat",
  "Tanvir",
  "Sadia",
  "Rakib",
  "Mim",
  "Shakib",
  "Farhana",
  "Imran",
  "Tasnim",
  "Rifat",
  "Jannat",
  "Naeem",
  "Sumaiya",
  "Fahim",
  "Anika",
  "Sabbir",
  "Maliha",
  "Rezaul",
  "Nabila",
  "Hasib",
  "Tania",
  "Mahfuz",
  "Rumana",
  "Shafin",
  "Lamia",
  "Zahid",
  "Priya",
  "Aminul",
  "Sharmin",
  "Ridwan",
  "Ishrat",
  "Nawshin",
  "Tahmid",
  "Raisa",
  "Mushfiq",
  "Oishi",
  "Adnan",
  "Samira",
  "Tamim",
];
const LAST_NAMES = [
  "Ahmed",
  "Rahman",
  "Islam",
  "Chowdhury",
  "Hossain",
  "Karim",
  "Akter",
  "Sarker",
  "Bhuiyan",
  "Mollah",
  "Talukder",
  "Siddique",
  "Alam",
  "Haque",
  "Mahmud",
  "Khan",
  "Uddin",
  "Nahar",
];
const DESIGNATIONS = [
  "Software Engineer",
  "Senior Software Engineer",
  "Lead Engineer",
  "Product Designer",
  "QA Engineer",
  "Content Writer",
  "Video Editor",
  "Motion Designer",
  "Account Manager",
  "Media Buyer",
  "Data Analyst",
  "DevOps Engineer",
  "HR Executive",
  "Accounts Officer",
  "Project Coordinator",
  "Customer Support Executive",
  "Business Development Executive",
];
const DEPARTMENTS = [
  "Engineering",
  "Design",
  "Marketing",
  "Finance",
  "People",
  "Operations",
  "Support",
];
const BLOOD = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"];
const BANKS = [
  "BRAC Bank",
  "City Bank",
  "Dutch-Bangla Bank",
  "Eastern Bank",
  "Islami Bank Bangladesh",
  "Prime Bank",
  "Standard Chartered Bank",
  "Sonali Bank",
];
const CHALLAN_BANKS = [
  "Sonali Bank",
  "Janata Bank",
  "Agrani Bank",
  "Rupali Bank",
  "Bangladesh Bank",
];
const AREAS = [
  "Gulshan",
  "Banani",
  "Dhanmondi",
  "Uttara",
  "Mohakhali",
  "Motijheel",
  "Mirpur",
  "Bashundhara",
];

/** Tools the company pays for. Name, plan, and where it belongs on the books. */
const TOOLS = [
  ["Claude", "Max", "ai_tool"],
  ["ChatGPT", "Team", "ai_tool"],
  ["Midjourney", "Standard", "ai_tool"],
  ["Perplexity", "Enterprise", "ai_tool"],
  ["ElevenLabs", "Creator", "ai_tool"],
  ["GitHub", "Team", "development"],
  ["Vercel", "Pro", "development"],
  ["Sentry", "Team", "development"],
  ["Postman", "Team", "development"],
  ["JetBrains", "All Products", "development"],
  ["Linear", "Standard", "management"],
  ["Jira", "Premium", "management"],
  ["Notion", "Plus", "productivity"],
  ["Slack", "Pro", "productivity"],
  ["Zoom", "Business", "productivity"],
  ["Loom", "Business", "productivity"],
  ["Grammarly", "Business", "productivity"],
  ["Figma", "Organisation", "design"],
  ["Adobe CC", "All Apps", "design"],
  ["Canva", "Teams", "design"],
  ["Meta Ads", "Business", "marketing"],
  ["Google Ads", "Business", "marketing"],
  ["Ahrefs", "Standard", "marketing"],
  ["Buffer", "Team", "marketing"],
  ["Intercom", "Advanced", "marketing"],
  ["BambooHR", "Essentials", "hr"],
  ["Deel", "Standard", "hr"],
  ["Airalo", "Data plan", "esim"],
  ["Hetzner", "CX32", "server_support"],
  ["DigitalOcean", "Droplets", "server_support"],
  ["Cloudflare", "Business", "server_support"],
  ["Datadog", "Pro", "server_support"],
  ["Xero", "Growing", "finance"],
  ["Wise", "Business", "finance"],
] as const;

/* -------------------------------------------------------------------------- */
/*  Categories to add, so the tree passes a hundred                             */
/* -------------------------------------------------------------------------- */

/** Keyed by the parent's slug. Existing children are never duplicated. */
const EXTRA_CHILDREN: Record<string, string[]> = {
  "office-premises": [
    "Generator fuel",
    "Lift maintenance",
    "Air conditioning",
    "Furniture & fixtures",
    "Pest control",
    "Waste disposal",
    "Building service charge",
    "Parking",
    "Signage",
    "Renovation",
    "Utility deposits",
    "Gardening",
  ],
  people: [
    "Festival bonus",
    "Overtime",
    "Provident fund",
    "Gratuity",
    "Staff welfare",
    "Medical allowance",
    "Transport allowance",
    "Mobile allowance",
    "Leave encashment",
    "Group insurance",
    "Team events",
    "Severance",
  ],
  technology: [
    "AI tools",
    "Cloud storage",
    "Developer tools",
    "Security & VPN",
    "API credits",
    "Laptops",
    "Monitors & peripherals",
    "Mobile devices",
    "Network equipment",
    "Software licences",
    "Data & analytics",
    "Backup services",
  ],
  marketing: [
    "Facebook ads",
    "Google ads",
    "Influencer marketing",
    "SEO tools",
    "Email marketing",
    "Print & branding",
    "Sponsorships",
    "Video production",
    "Photography",
    "Market research",
    "Affiliate payouts",
    "Promotional gifts",
  ],
  administrative: [
    "Legal fees",
    "Audit fees",
    "Consultancy",
    "Courier & postage",
    "Printing & stationery",
    "Memberships",
    "Insurance",
    "Trade licence",
    "Vehicle running",
    "Fuel",
    "Hotel & lodging",
    "Visa & immigration",
  ],
  tax: [
    "VAT payment",
    "Withholding VAT",
    "Customs duty",
    "Tax penalty",
    "Tax consultancy",
    "Return filing fee",
    "Municipal tax",
    "Stamp duty",
  ],
  "other-expenses": [
    "Miscellaneous",
    "Donations & CSR",
    "Write-offs",
    "Exchange loss",
    "Fines & penalties",
    "Rounding",
    "Unclassified",
    "Petty expenses",
  ],
  "money-in": [
    "Investment received",
    "Loan received",
    "Interest income",
    "Exchange gain",
    "Service income",
    "Consulting income",
    "Affiliate income",
    "Grant received",
    "Asset sale",
    "Deposit returned",
  ],
};

/* -------------------------------------------------------------------------- */
/*  Insert helper                                                               */
/* -------------------------------------------------------------------------- */

type AnyTable = Parameters<typeof db.insert>[0];
/** The handle inside `db.transaction(...)`. Everything below writes through it. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function put(
  tx: Tx,
  label: string,
  table: AnyTable,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (!rows.length) {
    console.log(`  ${label.padEnd(22)} 0 (nothing to add)`);
    return;
  }
  if (DRY) {
    const short = rows.length < 100 ? "  <-- under 100" : "";
    console.log(
      `  ${label.padEnd(22)} ${String(rows.length).padStart(5)}${short}`,
    );
    return;
  }
  for (let i = 0; i < rows.length; i += CHUNK) {
    await tx
      .insert(table)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoNothing();
  }
  console.log(`  ${label.padEnd(22)} ${rows.length}`);
}

/* -------------------------------------------------------------------------- */
/*  Wipe                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Child tables first. Most of these cascade, but relying on that means the
 * order is enforced by whichever constraint happens to be declared rather than
 * by anything readable.
 */
const WIPE_ORDER = [
  "tds_allocations",
  "files",
  "ai_attachments",
  "ai_chats",
  "ai_corrections",
  "import_rows",
  "import_batches",
  "subscription_users",
  "payroll_lines",
  "notification_log",
  "notifications",
  "statements",
  "withholding_returns",
  "income_tax_records",
  "tds_deposits",
  "transactions",
  "payroll_runs",
  "compensation_history",
  "subscriptions",
  "team_members",
  "vendors",
  "fx_rates",
];

/** Everything below fills. Add a table here when you add it to `load`. */
const SEEDED = new Set([
  ...WIPE_ORDER,
  "accounts",
  "categories",
  "recovery_codes",
  "tax_policies",
  "tax_policy_bands",
  "user_two_factor",
  "users",
]);

/**
 * Tables this file deliberately leaves as it found them, and why. Each one is
 * a decision rather than an oversight, which is the difference between this
 * list and an empty table nobody noticed.
 */
const LEFT_ALONE = new Set([
  // One row, enforced: `CHECK (id = 1)`. There is no hundred to reach.
  "app_settings",
  // Written by the app as things happen. Wiping it would throw away the record
  // of who did what — the one table whose whole value is that it is not seeded.
  "audit_logs",
  // Live sessions. A fabricated token is a row nobody holds the other half of,
  // and deleting the real ones signs the owner out.
  "refresh_tokens",
]);

async function wipe(tx: Tx): Promise<void> {
  console.log("\nClearing the sample data\n");

  for (const table of WIPE_ORDER) {
    const result = await tx.execute(sql`delete from ${sql.identifier(table)}`);
    if (result.rowCount) {
      console.log(`  ${table.padEnd(22)} ${result.rowCount} removed`);
    }
  }

  // The sign-ins this file made, and only those. Everything hanging off a user
  // cascades — two-factor enrolments, recovery codes, sessions, chats — which
  // is exactly why the pattern names what to delete rather than what to spare.
  //
  // The role check is belt and braces: nothing here is created as a super
  // admin, and if that ever changes this still refuses to delete one.
  const gone = await tx.execute(
    sql`delete from users
         where email ilike ${SAMPLE_USERS} and role <> 'super_admin'`,
  );
  if (gone.rowCount) {
    console.log(`  ${"users".padEnd(22)} ${gone.rowCount} removed`);
  }

  // Every account except the two. Safe now: the transactions, payroll runs and
  // challans that pointed at them were deleted above, and those were the only
  // references the database refuses to break.
  const dropped = await tx.execute(
    sql`delete from accounts where lower(name) not in (${sql.join(
      KEEP_ACCOUNTS.map((n) => sql`${n}`),
      sql`, `,
    )})`,
  );
  if (dropped.rowCount) {
    console.log(`  ${"accounts".padEnd(22)} ${dropped.rowCount} removed`);
  }

  const [{ kept }] = (
    await tx.execute<{ kept: number }>(
      sql`select count(*)::int as kept from users`,
    )
  ).rows;

  console.log(
    `\nKept: the two accounts, ${kept} real sign-in(s) with their sessions,\n` +
      "two-factor and recovery codes, the category tree, the settings row,\n" +
      "the tax policy and the audit log.\n",
  );
}

/* -------------------------------------------------------------------------- */
/*  Load                                                                        */
/* -------------------------------------------------------------------------- */

async function load(tx: Tx): Promise<void> {
  const [actor] = await tx
    .select({ id: users.id })
    .from(users)
    .where(sql`role = 'super_admin' and deleted_at is null`)
    .limit(1);

  // Thrown, not `process.exit` — this runs inside the transaction, and exiting
  // would take the process down with a wipe already done and never rolled back.
  if (!actor) {
    throw new Error(
      "No super admin. Run `npm run db:seed` first — everything here is " +
        "recorded as having been entered by somebody.",
    );
  }

  const stamp = { createdBy: actor.id, updatedBy: actor.id };
  console.log("\nLoading\n");

  /* --- accounts: the two, and no others -------------------------------- */

  const accountRows = await tx
    .select({
      id: accounts.id,
      name: accounts.name,
      openingBalance: accounts.openingBalance,
    })
    .from(accounts);

  const card = accountRows.find((a) => a.name.toLowerCase() === "master card");
  const bank = accountRows.find(
    (a) => a.name.toLowerCase() === "standard chartered bank",
  );

  if (!card || !bank) {
    throw new Error(
      "Expected 'Master card' and 'Standard Chartered Bank' to exist. " +
        "Add them on the Accounts screen, or run " +
        "deploy/sql/2026-08-18-two-accounts.sql, then run this again. " +
        "This file will not create accounts.",
    );
  }

  const extra = accountRows.filter(
    (a) => !KEEP_ACCOUNTS.includes(a.name.toLowerCase()),
  );
  if (extra.length) {
    console.log(
      `  ! ${extra.length} other account(s) still present: ` +
        `${extra.map((a) => a.name).join(", ")}\n` +
        `    Run \`npm run db:bulk -- reset\` to remove them.`,
    );
  }

  // The books start where the entries start. An opening balance dated after
  // them makes every running balance above it disagree with itself.
  const ledgerStart = iso(monthStart(WINDOW_MONTHS - 1));
  if (!DRY) {
    await tx.execute(
      sql`update accounts
             set opening_balance_on = ${ledgerStart}, updated_at = now()
           where id in (${card.id}, ${bank.id})
             and opening_balance_on > ${ledgerStart}`,
    );
  }
  console.log(
    `  ${"accounts".padEnd(22)} 2 (opening balances dated ${ledgerStart})`,
  );

  /* --- categories ------------------------------------------------------- */

  const parents = await tx
    .select({ id: categories.id, slug: categories.slug, kind: categories.kind })
    .from(categories)
    .where(sql`parent_id is null`);

  const existingChildren = await tx
    .select({ parentId: categories.parentId, slug: categories.slug })
    .from(categories)
    .where(sql`parent_id is not null`);

  const newCategories: Record<string, unknown>[] = [];
  for (const parent of parents) {
    const taken = new Set(
      existingChildren
        .filter((c) => c.parentId === parent.id)
        .map((c) => c.slug),
    );
    let order = taken.size;
    for (const name of EXTRA_CHILDREN[parent.slug] ?? []) {
      const slug = slugify(name);
      if (taken.has(slug)) continue;
      taken.add(slug);
      newCategories.push({
        name,
        slug,
        kind: parent.kind,
        parentId: parent.id,
        color: "#5b6472",
        sortOrder: (order += 1),
        isSystem: false,
        ...stamp,
      });
    }
  }
  await put(tx, "categories", categories, newCategories);

  // Read the whole tree back, so a transaction can be filed under a real one.
  const allCategories = await tx
    .select({
      id: categories.id,
      name: categories.name,
      kind: categories.kind,
      parentId: categories.parentId,
    })
    .from(categories);

  const childrenOnly = allCategories.filter((c) => c.parentId !== null);
  const outCats = childrenOnly.filter((c) => c.kind === "out");
  const inCats = childrenOnly.filter((c) => c.kind === "in");

  // Said plainly, because the alternative is `pick([])` returning undefined
  // and the first transaction failing on `undefined.id` — which reads as a bug
  // in this file rather than as a database that has no chart of accounts yet.
  if (!outCats.length || !inCats.length) {
    throw new Error(
      "No sub-categories to file entries under " +
        `(${outCats.length} out, ${inCats.length} in). ` +
        "Run `npm run db:seed-categories` first — every transaction below " +
        "needs a heading that already exists.",
    );
  }

  const catByName = new Map(
    childrenOnly.map((c) => [c.name.toLowerCase(), c.id]),
  );
  const cat = (name: string) =>
    catByName.get(name.toLowerCase()) ?? pick(outCats).id;

  /* --- vendors ---------------------------------------------------------- */

  const vendorNames: string[] = [];
  const seenVendor = new Set<string>();
  const addVendor = (name: string) => {
    const key = name.toLowerCase();
    if (seenVendor.has(key)) return;
    seenVendor.add(key);
    vendorNames.push(name);
  };

  for (const [tool] of TOOLS) addVendor(tool);
  for (const name of [
    "Beacon Properties Ltd",
    "Grameenphone",
    "Robi Axiata",
    "Banglalink",
    "Dhaka Electric Supply",
    "Titas Gas",
    "Dhaka WASA",
    "Link3 Technologies",
    "Amber IT",
    "National Board of Revenue",
    "Dhaka South City Corporation",
    "RJSC",
    "Sundarban Courier",
    "SA Paribahan",
    "Pathao",
    "Uber Bangladesh",
    "Foodpanda",
    "Aarong",
    "Rangs Electronics",
    "Transcom Electronics",
    "Startech",
    "Ryans Computers",
    "Computer Source",
    "Daraz Bangladesh",
    "Amazon Web Services",
    "Google Cloud",
    "Microsoft",
    "Apple",
    "Namecheap",
    "GoDaddy",
  ]) {
    addVendor(name);
  }

  const BASES = [
    "Rahman",
    "Karim",
    "Islam",
    "Chowdhury",
    "Hossain",
    "Sarker",
    "Bhuiyan",
    "Mollah",
    "Talukder",
    "Siddique",
    "Alam",
    "Haque",
    "Mahmud",
    "Khan",
    "Uddin",
    "Meghna",
    "Padma",
    "Jamuna",
    "Turag",
    "Buriganga",
  ];
  const SUFFIXES = [
    "Traders",
    "Enterprise",
    "Trading",
    "& Sons",
    "Corporation",
    "Suppliers",
    "Printing Press",
    "Motors",
    "Electronics",
    "Stationers",
    "Construction",
    "Agencies",
  ];
  outer: for (const suffix of SUFFIXES) {
    for (const base of BASES) {
      if (vendorNames.length >= TARGET) break outer;
      addVendor(`${base} ${suffix}`);
    }
  }

  const vendorRows = vendorNames.map((name, i) => {
    const isTool = i < TOOLS.length;
    const psr = pick(["submitted", "not_submitted", "unknown"] as const);
    const billingCycle = pick(["monthly", "yearly"]);
    return {
      id: randomUUID(),
      name,
      type: isTool
        ? ("ai_tool" as const)
        : pick([
            "supplier",
            "contractor",
            "landlord",
            "utility",
            "government",
            "hosting",
            "subscription",
            "other",
          ] as const),
      etin: maybe(0.7) ? String(between(100000000000, 999999999999)) : null,
      bin: maybe(0.4) ? String(between(1000000000000, 9999999999999)) : null,
      psrStatus: psr,
      psrAssessmentYear: psr === "submitted" ? "2025-2026" : null,
      contactName: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      phone: `01${between(3, 9)}${between(10000000, 99999999)}`,
      email: `accounts@${slugify(name).slice(0, 20)}.com`,
      address: `${between(1, 300)}/${pick(["A", "B", "C"])}, ${pick(
        AREAS,
      )}, Dhaka-${between(1200, 1230)}`,
      defaultCategoryId: pick(outCats).id,
      // The same trap `costUsd` fell into, one table over. `billingCurrency`
      // is USD for a tool, and `money()` multiplies by a hundred because every
      // other figure it makes is taka — so this read as $2,000 to $50,000 a
      // month. Plain dollars, in the same range the subscriptions use.
      billingCycle: isTool ? billingCycle : "none",
      billingAmount: isTool
        ? (billingCycle === "yearly"
            ? between(90, 1400)
            : between(8, 120)
          ).toFixed(2)
        : null,
      billingCurrency: isTool ? "USD" : "BDT",
      nextRenewalOn: isTool ? dayBefore(-between(1, 90)) : null,
      billingAccountId: isTool ? card.id : null,
      isActive: !maybe(0.12),
      notes: `Bulk sample ${TAG}`,
      ...stamp,
    };
  });
  await put(tx, "vendors", vendors, vendorRows);

  /* --- team --------------------------------------------------------------
   *
   * Joining dates are spread across the whole payroll history rather than
   * bunched: member 0 has been here ten years, member 119 started this month.
   * Every payroll run below then draws from whoever had actually joined by
   * that month, which is what makes an old run smaller than a recent one.
   */

  const memberRows = Array.from({ length: TARGET }, (_, i) => {
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const monthsAgo = TARGET - 1 - i;
    const joinedOn = dayIn(monthsAgo, between(1, 28));
    const status = maybe(0.08)
      ? ("resigned" as const)
      : maybe(0.05)
        ? ("on_leave" as const)
        : ("active" as const);
    const contractor = i % 8 === 0;

    return {
      id: randomUUID(),
      fullName: `${first} ${last}`,
      employeeCode: `SVF-${String(i + 1).padStart(4, "0")}`,
      engagementType: contractor
        ? ("contractor" as const)
        : ("employee" as const),
      status,
      designation: pick(DESIGNATIONS),
      department: pick(DEPARTMENTS),
      joinedOn,
      endedOn:
        status === "resigned"
          ? dayIn(Math.max(0, Math.min(monthsAgo, between(0, 18))), 25)
          : null,
      personalEmail: `${slugify(first)}.${slugify(last)}${i}@gmail.com`,
      workEmail: `${slugify(first)}${i}@demo.sharevirals.test`,
      phone: `01${between(3, 9)}${between(10000000, 99999999)}`,
      nid: String(between(1000000000, 9999999999)),
      etin: maybe(0.8) ? String(between(100000000000, 999999999999)) : null,
      psrStatus: pick(["submitted", "not_submitted", "unknown"] as const),
      bankName: pick(BANKS),
      bankAccountNumber: String(between(1000000000000, 9999999999999)),
      bankRouting: String(between(100000000, 999999999)),
      walletProvider: pick(["bKash", "Nagad", "Rocket"]),
      walletNumber: `01${between(3, 9)}${between(10000000, 99999999)}`,
      address: `House ${between(1, 90)}, Road ${between(1, 25)}, ${pick(
        AREAS,
      )}, Dhaka`,
      permanentAddress: `Village ${pick(LAST_NAMES)}pur, ${pick([
        "Comilla",
        "Barisal",
        "Khulna",
        "Rajshahi",
        "Sylhet",
        "Rangpur",
      ])}`,
      dateOfBirth: iso(
        new Date(Date.UTC(between(1985, 2003), between(0, 11), between(1, 28))),
      ),
      gender: pick(["male", "female"]),
      maritalStatus: pick(["single", "married"]),
      spouseName: maybe(0.4) ? `${pick(FIRST_NAMES)} ${last}` : null,
      fatherName: `${pick(FIRST_NAMES)} ${last}`,
      motherName: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      bloodGroup: pick(BLOOD),
      religion: pick(["Islam", "Hinduism", "Christianity", "Buddhism"]),
      passportNumber: maybe(0.35) ? `BW${between(1000000, 9999999)}` : null,
      emergencyContactName: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      emergencyContactRelation: pick(["Father", "Mother", "Spouse", "Sibling"]),
      emergencyContactPhone: `01${between(3, 9)}${between(10000000, 99999999)}`,
      probationUntil: dayIn(Math.max(0, monthsAgo - 6), 28),
      confirmedOn: monthsAgo > 6 ? dayIn(monthsAgo - 6, 1) : null,
      lastQualification: pick(["BSc", "MSc", "BBA", "MBA", "Diploma"]),
      educationLevel: pick(["Bachelor", "Master", "Diploma"]),
      educationMajor: pick([
        "CSE",
        "EEE",
        "BBA",
        "Marketing",
        "Finance",
        "English",
        "Design",
      ]),
      joiningSalary: (between(25, 180) * 1000).toFixed(2),
      notes: `Bulk sample ${TAG}`,
      ...stamp,
    };
  });
  await put(tx, "team_members", teamMembers, memberRows);

  /* --- compensation: a starting salary and the revisions since ---------- */

  const compRows: Record<string, unknown>[] = [];
  const salaryNow = new Map<string, number>();
  memberRows.forEach((m, i) => {
    const monthsAgo = TARGET - 1 - i;
    let gross = between(25, 160) * 1000;
    // One revision a year, at most three, and never dated before joining.
    const revisions = Math.min(3, Math.floor(monthsAgo / 12));
    for (let r = 0; r <= revisions; r += 1) {
      const at = Math.max(0, monthsAgo - r * 12);
      compRows.push({
        teamMemberId: m.id,
        grossAmount: gross.toFixed(2),
        currency: "BDT",
        effectiveFrom: r === 0 ? m.joinedOn : dayIn(at, 1),
        changeReason:
          r === 0
            ? "Joining salary"
            : pick(["Annual increment", "Promotion", "Market adjustment"]),
        createdBy: actor.id,
      });
      gross = Math.round((gross * (1 + between(8, 22) / 100)) / 500) * 500;
    }
    salaryNow.set(m.id, gross);
  });
  await put(tx, "compensation_history", compensationHistory, compRows);

  /* --- sign-ins ----------------------------------------------------------
   *
   * A bcrypt hash of nothing. These exist so the Users screen has rows to page
   * through and roles to filter by; none of them can sign in, and that is the
   * point — a sample account with a known password on a live site is a door.
   */

  const unusable =
    "$2b$12$0000000000000000000000000000000000000000000000000000";
  const userRows = Array.from({ length: TARGET }, (_, i) => ({
    id: randomUUID(),
    email: `sample${i}@demo.sharevirals.test`,
    fullName: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
    passwordHash: unusable,
    /*
     * No CFOs, and that is not an oversight about roles.
     *
     * The renewal reminder mails everybody who is `cfo` or `super_admin` and
     * active. A fifth of a hundred and twenty sample sign-ins would have been
     * around nineteen active CFOs at demo.sharevirals.test, and every morning
     * at nine the job would have posted a real Resend message to each of them.
     * They all bounce — the address does not exist and `.test` never resolves
     * — and a provider that scores senders counts those against the mail that
     * matters. The service says so itself, in the comment above that query.
     *
     * Sample data is not allowed to change who gets production email. There is
     * no CFO on this system today; there is still none afterwards. Add a real
     * one on the Users screen if the role is wanted.
     */
    role: pick(["admin", "finance", "hr", "ceo"] as const),
    status: maybe(0.12)
      ? ("disabled" as const)
      : maybe(0.1)
        ? ("invited" as const)
        : ("active" as const),
    teamMemberId: i < memberRows.length ? (memberRows[i].id as string) : null,
    lastLoginAt: maybe(0.6)
      ? new Date(`${dayBefore(between(1, 120))}T09:${between(10, 59)}:00Z`)
      : null,
    mustChangePassword: maybe(0.2),
  }));
  await put(tx, "users", users, userRows);

  /* --- transactions ------------------------------------------------------
   *
   * Two accounts, two years, and a shape that repeats every month: money
   * arrives from the CEO into the bank, salaries and vendors go out of it, a
   * settlement moves across to the card, and the card pays for the tools.
   *
   * References are the app's own format, `TXN-2026-000123`, and numbered per
   * calendar year — so the next entry typed on the screen continues the
   * sequence instead of starting a second one beside it.
   */

  const refCounters = new Map<number, number>();
  const nextRef = (date: string) => {
    const year = Number(date.slice(0, 4));
    const n = (refCounters.get(year) ?? 0) + 1;
    refCounters.set(year, n);
    return `TXN-${year}-${String(n).padStart(6, "0")}`;
  };

  type Txn = Record<string, unknown>;
  const txns: Txn[] = [];

  const addTxn = (t: Txn & { txnDate: string }) => {
    const row: Txn = {
      id: randomUUID(),
      refNo: nextRef(t.txnDate),
      currency: "BDT",
      usdRate: usdRateOn(t.txnDate),
      paymentMethod: "bank_transfer",
      createdVia: "manual",
      notes: `Bulk sample ${TAG}`,
      ...stamp,
      ...t,
    };
    txns.push(row);
    return row;
  };

  const activeVendors = vendorRows.filter((v) => v.isActive);
  const toolVendors = vendorRows.slice(0, TOOLS.length);
  const landlord = vendorRows.find((v) => v.name === "Beacon Properties Ltd");
  const clientCats = inCats.filter((c) => c.name !== "CEO funding");

  for (let back = WINDOW_MONTHS - 1; back >= 0; back -= 1) {
    const month = iso(monthStart(back)).slice(0, 7);

    /* Money in — the CEO's wires. Dollars sent, taka landed. */
    for (let w = 0; w < between(2, 4); w += 1) {
      // The first one lands in the first days of the month, before the rent
      // and the vendors it is there to cover. Dated later, the opening month
      // spends money it has not been given yet and the register dips under.
      const date = dayIn(back, w === 0 ? between(1, 4) : between(5, 26));
      const rate = usdRateOn(date);
      // Sized against the month it has to cover: twenty-five salaries, two
      // Eid bonuses a year, rent, the vendors and the card settlement. Guessed
      // at first and it put the bank three crore under — the closing balances
      // printed at the end of this file are what caught it.
      const usd = between(12000, 19000);
      addTxn({
        accountId: bank.id,
        direction: "in",
        txnDate: date,
        amount: (usd * Number(rate)).toFixed(2),
        categoryId: cat("CEO funding"),
        description: `Funding from CEO — ${month}`,
        originalAmount: usd.toFixed(2),
        originalCurrency: "USD",
        fxRate: rate,
        fxRateSource: "manual",
        senderBankName: pick(["Wise", "Payoneer", "Bank of America"]),
        senderAccountName: "ShareViral Corp",
        senderAccountNumber: String(between(100000000, 999999999)),
        senderSwiftCode: pick(["TRWIBEB1XXX", "BOFAUS3NXXX", "PAYOGB21XXX"]),
        reference: `FT${between(10000000000, 99999999999)}`,
      });
    }

    /* A client receipt or two, so "money in" is not one heading. */
    if (maybe(0.7) && clientCats.length) {
      const payer = pick(activeVendors);
      addTxn({
        accountId: bank.id,
        direction: "in",
        txnDate: dayIn(back, between(5, 25)),
        amount: money(1500, 9000),
        categoryId: pick(clientCats).id,
        description: `Client receipt — ${payer.name}`,
        counterparty: payer.name,
        invoiceNo: `INV-${between(1000, 9999)}`,
        reference: `BNK${between(100000, 999999)}`,
      });
    }

    /* Rent, in the first few days, every month without fail. */
    const rentBill = between(2000, 2200) * 100;
    const rentTds = Math.round(rentBill * 0.05);
    addTxn({
      accountId: bank.id,
      direction: "out",
      txnDate: dayIn(back, between(1, 5)),
      amount: (rentBill - rentTds).toFixed(2),
      categoryId: cat("Office rent"),
      vendorId: landlord?.id ?? null,
      description: `Office rent — ${month}`,
      invoiceNo: `RENT-${month}`,
      billAmount: rentBill.toFixed(2),
      withheldTaxAmount: rentTds.toFixed(2),
      paymentMethod: "cheque",
      reference: `CHQ${between(100000, 999999)}`,
    });

    /* The rest of the bank's month. */
    for (let v = 0; v < between(7, 11); v += 1) {
      const vendor = pick(activeVendors);
      const amount = money(80, 1200);
      const withheld = maybe(0.35)
        ? (Number(amount) * 0.03).toFixed(2)
        : "0.00";
      addTxn({
        accountId: bank.id,
        direction: "out",
        txnDate: dayIn(back, between(1, 28)),
        amount,
        categoryId: pick(outCats).id,
        vendorId: vendor.id,
        description: `${vendor.name} — ${month}`,
        invoiceNo: maybe(0.6) ? `INV-${between(1000, 9999)}` : null,
        reference: `BNK${between(100000, 999999)}`,
        billAmount:
          withheld === "0.00"
            ? null
            : (Number(amount) + Number(withheld)).toFixed(2),
        withheldTaxAmount: withheld,
        paymentMethod: pick([
          "bank_transfer",
          "cheque",
          "mobile_banking",
        ] as const),
        receiptUrl: maybe(0.3)
          ? `https://drive.google.com/file/d/${randomUUID().replace(/-/g, "")}/view`
          : null,
      });
    }

    /* The settlement across to the card: two rows, one group. */
    const transferGroupId = randomUUID();
    const transferDate = dayIn(back, between(20, 27));
    // Enough to cover the card's month. Less, and the card drifts negative
    // over two years — which for a card is arguable, and for a screen that
    // prints a balance is just a figure nobody asked for.
    const transferAmount = money(4000, 5500);
    addTxn({
      accountId: bank.id,
      direction: "out",
      txnDate: transferDate,
      amount: transferAmount,
      description: "Transfer to Master card",
      transferGroupId,
      reference: `TRF${between(100000, 999999)}`,
    });
    addTxn({
      accountId: card.id,
      direction: "in",
      txnDate: transferDate,
      amount: transferAmount,
      description: "Transfer from Standard Chartered Bank",
      transferGroupId,
      reference: `TRF${between(100000, 999999)}`,
    });

    /* The card's month: tools, in dollars, settled in taka. */
    for (let t = 0; t < between(9, 14); t += 1) {
      const date = dayIn(back, between(1, 28));
      const rate = usdRateOn(date);
      const vendor = pick(toolVendors);
      const usd = between(12, 420);
      addTxn({
        accountId: card.id,
        direction: "out",
        txnDate: date,
        amount: (usd * Number(rate)).toFixed(2),
        categoryId: cat(
          pick([
            "Software & subscriptions",
            "AI tools",
            "Hosting & servers",
            "Developer tools",
          ]),
        ),
        vendorId: vendor.id,
        description: `${vendor.name} — ${month}`,
        originalAmount: usd.toFixed(2),
        originalCurrency: "USD",
        fxRate: rate,
        fxRateSource: "manual",
        paymentMethod: "card",
        reference: `CRD${between(100000, 999999)}`,
        invoiceNo: maybe(0.5) ? `INV-SUB-${between(1000, 9999)}` : null,
      });
    }

    /* Small day-to-day items, so the card is not all software. */
    for (let s = 0; s < between(1, 4); s += 1) {
      addTxn({
        accountId: card.id,
        direction: "out",
        txnDate: dayIn(back, between(1, 28)),
        amount: money(20, 900),
        categoryId: cat(
          pick([
            "Food & hospitality",
            "Travel & transport",
            "Office supplies",
            "Courier & postage",
            "Fuel",
          ]),
        ),
        description: pick([
          "Team lunch",
          "Ride fares",
          "Stationery",
          "Courier charges",
          "Client meeting",
          "Office snacks",
          "Fuel",
          "Parking",
        ]),
        paymentMethod: "card",
        reference: `CRD${between(100000, 999999)}`,
      });
    }
  }

  /* --- payroll runs, and the salary payments that settled them ---------- */

  const runRows: Record<string, unknown>[] = [];
  const lineRows: Record<string, unknown>[] = [];
  /** Lines by `year-month`, so a challan can find the month it covers. */
  const linesByPeriod = new Map<string, { id: string; tdsAmount: string }[]>();

  for (let back = 0; back < TARGET; back += 1) {
    const start = monthStart(back);
    const year = start.getUTCFullYear();
    const month = start.getUTCMonth() + 1;
    const runId = randomUUID();

    // Whoever had joined by that month, capped so an old run is small and a
    // recent one is a full page.
    const eligible = memberRows.filter((m, i) => {
      const joinedBack = TARGET - 1 - i;
      if (joinedBack < back) return false;
      if (m.endedOn && m.endedOn < iso(start)) return false;
      return true;
    });
    const onRun = eligible.slice(-25);
    if (!onRun.length) continue;

    const status = back === 0 ? "draft" : back === 1 ? "finalized" : "paid";
    const inWindow = back < WINDOW_MONTHS;
    const paymentDate = status === "paid" ? dayIn(back, 28) : null;

    const lines = onRun.map((m) => {
      const gross = salaryNow.get(m.id) ?? 40000;
      const scaled = Math.round((gross * (1 - back * 0.004)) / 100) * 100;
      const bonus = month === 4 || month === 6 ? scaled : 0;
      const tds = Math.round(scaled * 0.035);
      const other = maybe(0.15) ? between(2, 20) * 100 : 0;
      return {
        id: randomUUID(),
        payrollRunId: runId,
        teamMemberId: m.id,
        grossAmount: scaled.toFixed(2),
        bonusAmount: bonus.toFixed(2),
        otherAdditions: "0.00",
        tdsAmount: tds.toFixed(2),
        otherDeductions: other.toFixed(2),
        deductionNote: other
          ? pick(["Late attendance", "Advance recovery"])
          : null,
        isPaid: status === "paid",
        paidOn: paymentDate,
        transactionId: null as string | null,
        snapshotDesignation: m.designation,
        snapshotDepartment: m.department,
        snapshotBankName: m.bankName,
        snapshotBankAccount: m.bankAccountNumber,
        snapshotEtin: m.etin,
        workingDays: 30,
        paidDays: maybe(0.1) ? between(24, 29) : 30,
        updatedBy: actor.id,
      };
    });

    const totals = lines.reduce(
      (acc, l) => ({
        gross: acc.gross + Number(l.grossAmount),
        additions: acc.additions + Number(l.bonusAmount),
        tds: acc.tds + Number(l.tdsAmount),
        deductions: acc.deductions + Number(l.otherDeductions),
      }),
      { gross: 0, additions: 0, tds: 0, deductions: 0 },
    );
    const net =
      totals.gross + totals.additions - totals.tds - totals.deductions;

    // A paid run inside the ledger window has a real payment behind it. Older
    // runs are marked paid with no transaction — which is what a system loaded
    // from years of paper actually looks like, and is a state the screens
    // should survive rather than a state they should never see.
    if (status === "paid" && inWindow) {
      const txn = addTxn({
        accountId: bank.id,
        direction: "out",
        txnDate: paymentDate as string,
        amount: net.toFixed(2),
        categoryId: cat("Salary"),
        description: `Salary — ${MONTHS[month - 1]} ${year}`,
        invoiceNo: `SAL-${year}-${String(month).padStart(2, "0")}`,
        billAmount: (totals.gross + totals.additions).toFixed(2),
        withheldTaxAmount: totals.tds.toFixed(2),
        createdVia: "payroll",
        payrollRunId: runId,
        reference: `PAY${between(100000, 999999)}`,
      });
      for (const l of lines) l.transactionId = txn.id as string;
    }

    runRows.push({
      id: runId,
      periodYear: year,
      periodMonth: month,
      label: `${MONTHS[month - 1]} ${year}`,
      status,
      paymentMode: "consolidated",
      accountId: status === "draft" ? null : bank.id,
      paymentDate,
      paymentMethod: "bank_transfer",
      totalGross: totals.gross.toFixed(2),
      totalAdditions: totals.additions.toFixed(2),
      totalTds: totals.tds.toFixed(2),
      totalDeductions: totals.deductions.toFixed(2),
      totalNet: net.toFixed(2),
      finalizedAt:
        status === "draft" ? null : new Date(`${dayIn(back, 27)}T10:00:00Z`),
      finalizedBy: status === "draft" ? null : actor.id,
      notes: `Bulk sample ${TAG}`,
      ...stamp,
    });
    lineRows.push(...lines);
    linesByPeriod.set(`${year}-${month}`, lines);
  }

  /* --- TDS challans ------------------------------------------------------
   *
   * One a month, covering the previous month's salary deductions — which is
   * what the deposit deadline is counted from, not the day it was paid.
   */

  const depositRows: Record<string, unknown>[] = [];
  const allocationRows: Record<string, unknown>[] = [];

  for (let back = 1; back <= TARGET; back += 1) {
    const period = monthStart(back);
    const covered =
      linesByPeriod.get(
        `${period.getUTCFullYear()}-${period.getUTCMonth() + 1}`,
      ) ?? [];
    const total = covered.reduce((sum, l) => sum + Number(l.tdsAmount), 0);
    if (total <= 0) continue;

    const depositId = randomUUID();
    const depositDate = dayIn(back - 1, between(8, 14));
    const inWindow = back < WINDOW_MONTHS;

    let transactionId: string | null = null;
    if (inWindow) {
      const txn = addTxn({
        accountId: bank.id,
        direction: "out",
        txnDate: depositDate,
        amount: total.toFixed(2),
        categoryId: cat("TDS deposit"),
        description: `TDS deposit — ${MONTHS[period.getUTCMonth()]} ${period.getUTCFullYear()}`,
        createdVia: "tax_payment",
        reference: `CHL${between(100000, 999999)}`,
      });
      transactionId = txn.id as string;
    }

    depositRows.push({
      id: depositId,
      challanNumber: `A-${period.getUTCFullYear()}${between(100000, 999999)}`,
      challanDate: depositDate,
      depositDate,
      amount: total.toFixed(2),
      bankName: pick(CHALLAN_BANKS),
      branch: pick([
        "Motijheel",
        "Gulshan",
        "Dhanmondi",
        "Uttara",
        "Local Office",
      ]),
      periodYear: period.getUTCFullYear(),
      periodMonth: period.getUTCMonth() + 1,
      depositType: "salary",
      accountId: inWindow ? bank.id : null,
      transactionId,
      notes: `Bulk sample ${TAG}`,
      ...stamp,
    });

    // Which deductions this challan covers. Three lines a challan: the point
    // is that the allocation screen has rows, not that every taka is traced.
    for (const line of covered.slice(0, 3)) {
      allocationRows.push({
        depositId,
        payrollLineId: line.id,
        amount: line.tdsAmount,
      });
    }
  }

  /* --- corporate tax -----------------------------------------------------
   *
   * Four advance instalments and a final return per assessment year, which is
   * the shape the NBR asks for. Older years are paid and filed; the current
   * one is part-way through.
   */

  const taxRows: Record<string, unknown>[] = [];
  for (let y = 0; taxRows.length < TARGET; y += 1) {
    const endYear = 2026 - y;
    const assessmentYear = `${endYear}-${String(endYear + 1).slice(2)}`;
    const incomeStart = iso(new Date(Date.UTC(endYear - 1, 6, 1)));
    const incomeEnd = iso(new Date(Date.UTC(endYear, 5, 30)));
    const settled = y > 0;

    for (let q = 1; q <= 4; q += 1) {
      const dueMonth = [8, 11, 2, 5][q - 1];
      const dueYear = q <= 2 ? endYear - 1 : endYear;
      const payable = between(80, 400) * 1000;
      const paid = settled ? payable : q <= 2 ? payable : 0;
      const paidOn = paid
        ? iso(new Date(Date.UTC(dueYear, dueMonth, between(1, 14))))
        : null;
      taxRows.push({
        assessmentYear,
        incomeYearStart: incomeStart,
        incomeYearEnd: incomeEnd,
        recordType: "advance_quarter",
        quarter: q,
        dueDate: iso(new Date(Date.UTC(dueYear, dueMonth, 15))),
        amountPayable: payable.toFixed(2),
        amountPaid: paid.toFixed(2),
        paidOn,
        challanNumber: paid ? `A-${dueYear}${between(100000, 999999)}` : null,
        challanDate: paidOn,
        status:
          paid >= payable ? "paid" : paid > 0 ? "partially_paid" : "pending",
        notes: `Bulk sample ${TAG}`,
        ...stamp,
      });
    }

    const finalPayable = between(200, 900) * 1000;
    const filedOn = settled
      ? iso(new Date(Date.UTC(endYear, 11, between(1, 14))))
      : null;
    taxRows.push({
      assessmentYear,
      incomeYearStart: incomeStart,
      incomeYearEnd: incomeEnd,
      recordType: "final_return",
      quarter: null,
      dueDate: iso(new Date(Date.UTC(endYear, 11, 15))),
      amountPayable: finalPayable.toFixed(2),
      amountPaid: settled ? finalPayable.toFixed(2) : "0.00",
      paidOn: filedOn,
      returnSubmittedOn: filedOn,
      acknowledgementNo: settled
        ? `ACK-${endYear}-${between(100000, 999999)}`
        : null,
      status: settled ? "filed" : "pending",
      notes: `Bulk sample ${TAG}`,
      ...stamp,
    });
  }

  /* --- withholding returns ----------------------------------------------
   *
   * One per quarter per fiscal year, which is the only axis this register has
   * — a hundred rows therefore means thirty years of filings. The early ones
   * are history a company would have inherited, not invented activity.
   */

  const withholdingRows: Record<string, unknown>[] = [];
  for (let y = 0; withholdingRows.length < TARGET; y += 1) {
    const fy = 2026 - y;
    for (let q = 1; q <= 4; q += 1) {
      const startMonth = [6, 9, 0, 3][q - 1];
      const yearOf = q <= 2 ? fy - 1 : fy;
      const dueDate = new Date(Date.UTC(yearOf, startMonth + 3, 25));
      const filed = dueDate < TODAY;
      withholdingRows.push({
        fiscalYear: fy,
        quarter: q,
        periodStart: iso(new Date(Date.UTC(yearOf, startMonth, 1))),
        periodEnd: iso(new Date(Date.UTC(yearOf, startMonth + 3, 0))),
        dueDate: iso(dueDate),
        filedOn: filed
          ? iso(new Date(Date.UTC(yearOf, startMonth + 3, between(15, 25))))
          : null,
        acknowledgementNo: filed
          ? `WH-${fy}Q${q}-${between(10000, 99999)}`
          : null,
        status: filed ? (maybe(0.12) ? "late" : "filed") : "pending",
        notes: `Bulk sample ${TAG}`,
        updatedBy: actor.id,
      });
    }
  }

  /* --- subscriptions ----------------------------------------------------- */

  const PLAN_VARIANTS = [
    ["monthly", ""],
    ["yearly", " (annual)"],
    ["monthly", " — team"],
    ["yearly", " — enterprise"],
  ] as const;

  const subscriptionRows = Array.from({ length: TARGET }, (_, i) => {
    const [tool, plan, category] = TOOLS[i % TOOLS.length];
    const [cycle, label] = PLAN_VARIANTS[Math.floor(i / TOOLS.length) % 4];
    /*
     * Dollars, and therefore not `money()`.
     *
     * That helper multiplies by a hundred, because every other figure it makes
     * is a taka amount and a subscription's cost is the one column here
     * denominated in dollars. Through it, a Hetzner box was priced at
     * thirty-four thousand dollars and reached the screen as a plan costing
     * forty-two lakh taka a year — plausible enough in a column of large
     * numbers to be read straight past, and wrong by two orders of magnitude.
     *
     * A yearly plan costs roughly ten months of the monthly one, which is what
     * makes the four variants read as one market rather than four.
     */
    const usd = (
      cycle === "yearly" ? between(90, 1400) : between(8, 120)
    ).toFixed(2);
    const startDate = dayBefore(between(60, 700));
    const rate = usdRateOn(startDate);
    return {
      id: randomUUID(),
      vendorId: vendorRows.find((v) => v.name === tool)?.id ?? null,
      toolName: `${tool}${label}`,
      websiteUrl: `https://${slugify(tool)}.com`,
      planName: plan,
      category,
      status: maybe(0.1)
        ? "canceled"
        : maybe(0.08)
          ? "paused"
          : maybe(0.06)
            ? "expired"
            : "active",
      costUsd: usd,
      costBdt: (Number(usd) * Number(rate)).toFixed(2),
      usdRate: rate,
      billingCycle: cycle,
      startDate,
      nextRenewalOn: dayBefore(-between(1, 75)),
      renewalNote: maybe(0.25)
        ? pick(["Review before renewal", "Downgrade planned"])
        : null,
      paymentMethod: "card",
      accountId: card.id,
      boughtFor: pick(DEPARTMENTS),
      invoiceNo: maybe(0.7) ? `INV-SUB-${between(1000, 9999)}` : null,
      reference: maybe(0.8) ? `CRD${between(100000, 999999)}` : null,
      /*
       * Free text, never an address — and this one is load-bearing.
       *
       * The renewal reminder mails `loginEmail` whenever it parses as an
       * address, on top of the staff list. A hundred and twenty plans with
       * renewal dates spread over the next ten weeks means one or two of these
       * every morning, each a real Resend message to a `.test` domain that
       * cannot resolve, each a bounce counted against a sender reputation the
       * owner has just set up.
       *
       * The column is free text by design — the service's own comment says it
       * holds "shared account", or two addresses, or a note. So these are what
       * it actually tends to hold. None of them parses as an address, which is
       * what keeps the job from posting them.
       */
      loginEmail: pick([
        "shared team account",
        "SSO — Google Workspace",
        "billing login (see 1Password)",
        "finance shared login",
        "owner's personal account",
      ]),
      notes: `Bulk sample ${TAG}`,
      ...stamp,
    };
  });

  /* Seats, so "who is on it" has more than one name in it. */
  const seatRows: Record<string, unknown>[] = [];
  const seatSeen = new Set<string>();
  for (const sub of subscriptionRows) {
    for (let s = 0; s < between(1, 6); s += 1) {
      const member = pick(memberRows);
      const key = `${sub.id}:${member.id}`;
      if (seatSeen.has(key)) continue;
      seatSeen.add(key);
      seatRows.push({
        subscriptionId: sub.id,
        teamMemberId: member.id,
        fromDate: sub.startDate,
        untilDate: maybe(0.15) ? dayBefore(between(1, 100)) : null,
        status: maybe(0.15) ? "canceled" : "active",
        createdBy: actor.id,
      });
    }
  }

  /* --- exchange rates ---------------------------------------------------- */

  const rateRows = Array.from({ length: TARGET }, (_, i) => {
    const date = dayBefore(i);
    return {
      baseCurrency: "USD",
      quoteCurrency: "BDT",
      rate: usdRateOn(date),
      rateDate: date,
      source: i % 5 === 0 ? ("api" as const) : ("manual" as const),
      provider: i % 5 === 0 ? "exchangerate.host" : null,
      fetchedAt: i % 5 === 0 ? new Date(`${date}T06:00:00Z`) : null,
      notes: `Bulk sample ${TAG}`,
      ...stamp,
    };
  });

  /* --- statements -------------------------------------------------------- */

  const statementRows = Array.from({ length: TARGET }, (_, back) => {
    const start = monthStart(back);
    return {
      periodStart: iso(start),
      periodEnd: iso(monthEnd(back)),
      cycle: 1,
      status: back === 0 ? "draft" : "reconciled",
      audited: back > 2 && !maybe(0.2),
      // Arrays and objects, not JSON.stringify of them. These are `jsonb`
      // columns: handed a string, Postgres stores a JSON string, and the
      // screen reads back `"[]"` where it expected an empty list.
      notes:
        back === 0
          ? []
          : [
              `Reconciled against the bank statement for ${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}.`,
            ],
      signatories:
        back === 0 ? [] : [{ name: "Super Admin", title: "Head of Finance" }],
      committedForwardTxnIds: [],
      updatedBy: actor.id,
    };
  });

  /* --- the money, and everything that hangs off it ----------------------- */

  await put(tx, "transactions", transactions, txns);
  await put(tx, "payroll_runs", payrollRuns, runRows);
  await put(tx, "payroll_lines", payrollLines, lineRows);
  await put(tx, "tds_deposits", tdsDeposits, depositRows);
  await put(tx, "tds_allocations", tdsAllocations, allocationRows);
  await put(tx, "income_tax_records", incomeTaxRecords, taxRows);
  await put(tx, "withholding_returns", withholdingReturns, withholdingRows);
  await put(tx, "subscriptions", subscriptions, subscriptionRows);
  await put(tx, "subscription_users", subscriptionUsers, seatRows);
  await put(tx, "fx_rates", fxRates, rateRows);
  await put(tx, "statements", statements, statementRows);

  /* --- imports ----------------------------------------------------------- */

  const batchRows = Array.from({ length: TARGET }, (_, i) => {
    const total = between(20, 400);
    const errors = between(0, 12);
    const duplicates = between(0, 8);
    const valid = total - errors - duplicates;
    const status = pick([
      "committed",
      "committed",
      "committed",
      "previewed",
      "mapped",
      "uploaded",
      "reverted",
      "failed",
    ] as const);
    return {
      id: randomUUID(),
      target:
        i % 6 === 0 ? ("team_members" as const) : ("transactions" as const),
      filename: `${pick([
        "bank-statement",
        "expenses",
        "salary-sheet",
        "vendor-payments",
        "card-statement",
      ])}-${dayBefore(i * 3 + 1)}.xlsx`,
      status,
      columnMap: {
        Date: "txnDate",
        Description: "description",
        Debit: "amount",
        Reference: "reference",
      },
      defaults: { accountId: i % 2 ? card.id : bank.id },
      totalRows: total,
      validRows: valid,
      errorRows: errors,
      duplicateRows: duplicates,
      importedRows: status === "committed" ? valid : 0,
      uploadedBy: actor.id,
      committedAt:
        status === "committed"
          ? new Date(`${dayBefore(i * 3)}T11:00:00Z`)
          : null,
      revertedAt:
        status === "reverted"
          ? new Date(`${dayBefore(i * 3)}T12:00:00Z`)
          : null,
      createdAt: new Date(`${dayBefore(i * 3 + 1)}T10:00:00Z`),
    };
  });

  const importRowRows: Record<string, unknown>[] = [];
  for (const batch of batchRows.slice(0, 40)) {
    for (let r = 1; r <= 5; r += 1) {
      const status = pick([
        "imported",
        "imported",
        "valid",
        "error",
        "duplicate",
        "skipped",
      ] as const);
      importRowRows.push({
        batchId: batch.id,
        rowNumber: r,
        raw: {
          Date: dayBefore(between(1, 300)),
          Description: pick([
            "Office rent",
            "Server hosting",
            "Courier",
            "Ads",
          ]),
          Debit: money(50, 4000),
          Reference: `BNK${between(100000, 999999)}`,
        },
        mapped: { amount: money(50, 4000), direction: "out" },
        status,
        errors: status === "error" ? ["Amount is not a number"] : null,
        warning:
          status === "duplicate"
            ? "Looks like an entry already recorded"
            : null,
      });
    }
  }

  await put(tx, "import_batches", importBatches, batchRows);
  await put(tx, "import_rows", importRows, importRowRows);

  /* --- files -------------------------------------------------------------
   *
   * Rows only. There is no file on disk behind them, so a download will 404 —
   * these exist so the attachment lists, counts and filters have something to
   * show. Anything really uploaded through the app is unaffected.
   */

  const FILE_KINDS = [
    ["profile_photo", "image/jpeg", "photo.jpg"],
    ["cv", "application/pdf", "cv.pdf"],
    ["appointment_letter", "application/pdf", "appointment-letter.pdf"],
    ["nid", "image/jpeg", "nid.jpg"],
    ["etin_certificate", "application/pdf", "etin.pdf"],
  ] as const;

  const fileRows = Array.from({ length: TARGET }, (_, i) => {
    const [kind, mime, name] = FILE_KINDS[i % FILE_KINDS.length];
    const member = memberRows[i % memberRows.length];
    return {
      storageKey: `demo/${randomUUID()}`,
      originalName: `${slugify(member.fullName)}-${name}`,
      mimeType: mime,
      sizeBytes: between(20_000, 4_000_000),
      checksum: createHash("sha256").update(`demo-${i}`).digest("hex"),
      kind,
      label: `Bulk sample ${TAG}`,
      teamMemberId: member.id,
      uploadedBy: actor.id,
      createdAt: new Date(`${dayBefore(between(1, 400))}T10:00:00Z`),
    };
  });
  await put(tx, "files", files, fileRows);

  /* --- notifications sent ------------------------------------------------ */

  const NOTICES = [
    "renewal_due",
    "tds_deadline",
    "payroll_finalized",
    "withholding_due",
    "advance_tax_due",
  ];

  const noticeRows = Array.from({ length: TARGET }, (_, i) => {
    const outcome = maybe(0.1) ? "failed" : "sent";
    return {
      kind: NOTICES[i % NOTICES.length],
      subjectId: randomUUID(),
      subjectDate: dayBefore(i + 1),
      recipient: pick([
        "finance@shareviral.cash",
        "admin@shareviral.cash",
        "hr@shareviral.cash",
      ]),
      sentAt: new Date(`${dayBefore(i + 1)}T04:00:00Z`),
      outcome,
      error: outcome === "failed" ? "Resend returned 429" : null,
    };
  });
  await put(tx, "notification_log", notificationLog, noticeRows);

  /* --- the bell ----------------------------------------------------------
   *
   * A different table from the log above, and filled differently. The log is
   * one row per address a message was sent to; this is one row per *person*
   * per thing, with a read mark. So these are addressed to sign-ins that
   * exist — a bell row for nobody is a row the bell never counts.
   *
   * The super admin gets the first two dozen, about half of them unread, so
   * the bell in the top bar actually carries a number when the site is opened.
   * `notifications_once_idx` is (user, kind, dedupe_key), and the key carries
   * the index, so no two collide.
   */

  const BELL = [
    [
      "subscription_renewal",
      "renews in three days",
      "Three days' notice, so it can still be cancelled or changed.",
      "/subscriptions",
    ],
    [
      "tds_deadline",
      "TDS is due",
      "Deducted and not yet deposited.",
      "/tax/withholding",
    ],
    [
      "payroll_unpaid",
      "payroll is not paid",
      "The run exists and is finalized.",
      "/payroll",
    ],
    [
      "significant_change",
      "A money row was voided",
      "Voided by a member of the finance team.",
      "/audit",
    ],
  ] as const;

  const bellRows = Array.from({ length: TARGET }, (_, i) => {
    const [kind, headline, body, href] = BELL[i % BELL.length];
    const day = dayBefore(i + 1);
    const tool = TOOLS[i % TOOLS.length][0];
    return {
      userId: i < 24 ? actor.id : pick(userRows).id,
      kind,
      dedupeKey: `${kind}:${i}:${day}`,
      title:
        kind === "subscription_renewal"
          ? `${tool} ${headline}`
          : kind === "tds_deadline"
            ? `${headline} ${day}`
            : kind === "payroll_unpaid"
              ? `${day.slice(0, 7)} ${headline}`
              : headline,
      body,
      href,
      createdAt: new Date(`${day}T05:00:00Z`),
      // Half of the owner's are unread, so the bell has a count to show and a
      // read state to clear.
      readAt:
        i < 24 && i % 2 === 0
          ? null
          : maybe(0.6)
            ? new Date(`${day}T09:00:00Z`)
            : null,
    };
  });
  await put(tx, "notifications", notifications, bellRows);

  /* --- the assistant's history -------------------------------------------
   *
   * Most of it belongs to sample sign-ins, so the tables are full without the
   * real owner's own chat list becoming a hundred entries long. A dozen are
   * put on the super admin so the screen has history when he opens it.
   */

  const QUESTIONS = [
    "What did we spend on AI tools last month?",
    "Show me the top five vendors this quarter",
    "How much TDS is due this month?",
    "Which subscriptions renew in the next 30 days?",
    "What is the balance on the card?",
    "Compare salary cost this year against last",
    "Who joined in the last six months?",
    "How much did we pay Beacon Properties this year?",
    "What is our advance tax position?",
    "Break down office costs by month",
  ];

  const chatRows = Array.from({ length: TARGET }, (_, i) => {
    const question = QUESTIONS[i % QUESTIONS.length];
    return {
      id: randomUUID(),
      userId: i < 12 ? actor.id : pick(userRows).id,
      title: question.slice(0, 60),
      messages: [
        { role: "user", content: question },
        {
          role: "assistant",
          content: "Here is what the ledger shows for that period.",
        },
      ],
      reply: { kind: "answer", text: "See the figures above." },
      createdAt: new Date(`${dayBefore(i + 1)}T08:00:00Z`),
      updatedAt: new Date(`${dayBefore(i + 1)}T08:05:00Z`),
    };
  });
  await put(tx, "ai_chats", aiChats, chatRows);

  const attachmentRows = Array.from({ length: TARGET }, (_, i) => {
    const chat = chatRows[i % chatRows.length];
    return {
      userId: chat.userId,
      chatId: chat.id,
      filename: `upload-${dayBefore(i + 1)}.xlsx`,
      headers: ["Date", "Description", "Debit", "Credit"],
      rows: [
        [dayBefore(i + 2), "Office rent", money(1800, 2200), ""],
        [dayBefore(i + 3), "Server hosting", money(100, 900), ""],
      ],
      totalRows: between(2, 300),
      createdAt: new Date(`${dayBefore(i + 1)}T08:01:00Z`),
    };
  });
  await put(tx, "ai_attachments", aiAttachments, attachmentRows);

  const correctionRows = Array.from({ length: TARGET }, (_, i) => ({
    target: pick(["transaction", "vendor", "team_member", "subscription"]),
    said: pick(QUESTIONS),
    field: pick(["categoryId", "vendorId", "amount", "txnDate", "description"]),
    drafted: pick(["Office supplies", "Marketing", "12,000.00", "2026-07-14"]),
    corrected: pick([
      "Printing & stationery",
      "Advertising",
      "1,200.00",
      "2026-07-15",
    ]),
    userId: i < 10 ? actor.id : (pick(userRows).id as string),
    createdAt: new Date(`${dayBefore(i + 1)}T09:00:00Z`),
  }));
  await put(tx, "ai_corrections", aiCorrections, correctionRows);

  /* --- two-factor, on the sample sign-ins only ---------------------------
   *
   * Never on the five real accounts: a second factor enrolled behind somebody's
   * back, whose secret is in no authenticator app, is a lockout.
   */

  const twoFactorRows = userRows.map((u, i) => ({
    userId: u.id,
    secretEncrypted: seal(`DEMOSECRET${String(i).padStart(6, "0")}`),
    confirmedAt: maybe(0.6)
      ? new Date(`${dayBefore(between(1, 200))}T10:00:00Z`)
      : null,
    lastStep: between(50_000_000, 60_000_000),
    failedCount: maybe(0.2) ? between(1, 4) : 0,
  }));
  await put(tx, "user_two_factor", userTwoFactor, twoFactorRows);

  const codeRows: Record<string, unknown>[] = [];
  for (const u of userRows.slice(0, 16)) {
    for (let n = 0; n < 10; n += 1) {
      codeRows.push({
        userId: u.id,
        codeHash: createHash("sha256")
          .update(`${u.email}-recovery-${n}`)
          .digest("hex"),
        usedAt: maybe(0.15)
          ? new Date(`${dayBefore(between(1, 90))}T10:00:00Z`)
          : null,
      });
    }
  }
  await put(tx, "recovery_codes", recoveryCodes, codeRows);

  /* --- tax policies for earlier years ------------------------------------
   *
   * The FY2026 policy is the real one and is left exactly alone. The earlier
   * years carry the same band shape, which is what gives the bands table its
   * hundred rows — a policy is six bands, so twenty years is a hundred and
   * twenty.
   */

  const existingPolicies = await tx
    .select({ fiscalYear: taxPolicies.fiscalYear })
    .from(taxPolicies);
  const haveYear = new Set(existingPolicies.map((p) => p.fiscalYear));

  const policyRows: Record<string, unknown>[] = [];
  const bandRows: Record<string, unknown>[] = [];
  const BANDS: [number | null, number][] = [
    [350_000, 0],
    [100_000, 0.05],
    [400_000, 0.1],
    [500_000, 0.15],
    [500_000, 0.2],
    [null, 0.25],
  ];

  const wantPolicies = Math.max(0, 20 - existingPolicies.length);
  for (let y = 1; policyRows.length < wantPolicies; y += 1) {
    const fiscalYear = 2026 - y;
    if (haveYear.has(fiscalYear)) continue;
    const policyId = randomUUID();
    policyRows.push({
      id: policyId,
      fiscalYear,
      exemptionNumerator: 1,
      exemptionDenominator: 3,
      exemptionCap: "400000.00",
      exemptionMode: "lower",
      rebateInvestmentRate: "0.2500",
      rebateRate: "0.1500",
      rebateTaxableShare: "0.0300",
      rebateFixedCap: "1000000.00",
      assumeFullInvestment: true,
      minimumTax: "5000.00",
      minimumTaxEnabled: true,
      ...stamp,
    });
    BANDS.forEach(([width, rate], position) => {
      bandRows.push({
        policyId,
        position,
        width: width === null ? null : width.toFixed(2),
        rate: rate.toFixed(4),
      });
    });
  }
  await put(tx, "tax_policies", taxPolicies, policyRows);
  await put(tx, "tax_policy_bands", taxPolicyBands, bandRows);

  /* --- anything this file has not heard of -------------------------------
   *
   * The point of the exercise was a hundred rows in every table, and the
   * schema grows. A table added next month is not covered by anything above
   * and would sit empty, looking exactly like a table that was filled and then
   * went wrong. Asking the database what it has is the only way that stays
   * true without somebody remembering to come back here.
   */

  const { rows: present } = await tx.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables
         where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );

  const unknown = present
    .map((r) => r.table_name)
    .filter((name) => !SEEDED.has(name) && !LEFT_ALONE.has(name))
    .sort();

  if (unknown.length) {
    console.log(
      `\n  ! ${unknown.length} table(s) this seeder does not fill: ` +
        `${unknown.join(", ")}\n` +
        `    Add them to seed-bulk.ts, or to LEFT_ALONE if they should stay empty.`,
    );
  }

  /* --- where the two accounts land ---------------------------------------
   *
   * Printed rather than assumed. The seeder invents a monthly shape and the
   * shape has to add up: an account that ends the two years below zero is a
   * balance somebody would report as a bug, and the place to notice it is
   * here rather than on the dashboard.
   */

  console.log("\nClosing balances");
  for (const account of [bank, card]) {
    const ledger = txns
      .filter((t) => t.accountId === account.id)
      .sort((a, b) => (a.txnDate as string).localeCompare(b.txnDate as string));

    let running = Number(account.openingBalance);
    // The lowest the register ever gets, not just where it ends. A seeder can
    // land two years ahead and still have gone under in month three, and it is
    // the month-three figure somebody opens the dashboard on.
    let lowest = running;
    for (const t of ledger) {
      running += (t.direction === "in" ? 1 : -1) * Number(t.amount);
      if (running < lowest) lowest = running;
    }

    const taka = (n: number) =>
      Math.round(n).toLocaleString("en-IN").padStart(14);
    console.log(
      `  ${account.name.padEnd(26)} opening ${taka(Number(account.openingBalance))}` +
        `   lowest ${taka(lowest)}   closing ${taka(running)}` +
        `${lowest < 0 ? "   <-- goes negative" : ""}`,
    );
  }

  console.log("\nLoaded.\n");
}

/* -------------------------------------------------------------------------- */

const mode = process.argv[2];

/**
 * One transaction around the whole run, and `reset` is the reason.
 *
 * `reset` empties twenty-one tables and then puts five thousand rows back. Run
 * as separate statements, a failure anywhere in the second half — one bad
 * enum, one constraint nobody remembered — leaves a live database wiped and
 * half-loaded, with no undo and the previous contents already gone. Inside a
 * transaction the same failure rolls the delete back with it and the site is
 * exactly as it was.
 *
 * This works because the pool is node-postgres over Neon's wire protocol.
 * Neon's *http* driver cannot do this: each statement is its own request, and
 * `transaction()` there is a batch, not a transaction.
 */
async function main(): Promise<void> {
  if (mode === "dry") {
    console.log("\nDry run — building every row, writing none of them.");
    return db.transaction((tx) => load(tx));
  }
  if (mode === "wipe") return db.transaction((tx) => wipe(tx));
  if (mode === "reset") {
    return db.transaction(async (tx) => {
      await wipe(tx);
      await load(tx);
    });
  }
  return db.transaction((tx) => load(tx));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

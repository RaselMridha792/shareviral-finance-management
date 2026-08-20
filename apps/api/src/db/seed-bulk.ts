/**
 * Enough of everything that pagination, filters and totals can actually be
 * looked at.
 *
 *   npm run db:bulk         load it
 *   npm run db:bulk -- wipe remove it again
 *
 * `seed-demo.ts` tells a small, coherent story — one July, one August, a
 * handful of rows. That is the right thing for a first look and the wrong
 * thing for checking a table that only pages past twenty. Nothing here is a
 * story: it is volume, spread across every table and every category, so a
 * second page exists to click to and a total has something to be wrong about.
 *
 * Everything carries the same `[demo]` tag as the story seeder, so one wipe
 * removes both and neither can be confused for a real entry. The tables the
 * story seeder never touched — subscriptions, exchange rates, sign-ins — are
 * wiped here.
 *
 * Deliberately deterministic. A seeded generator rather than Math.random, so
 * two runs produce the same figures and "the total changed" is a finding
 * rather than the seeder.
 */

import { config } from "dotenv";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { poolOptionsFor } from "./connection";
import * as schema from "./schema";
import {
  accounts,
  categories,
  compensationHistory,
  fxRates,
  payrollLines,
  payrollRuns,
  subscriptionUsers,
  subscriptions,
  tdsDeposits,
  teamMembers,
  transactions,
  users,
} from "./schema";

config({ path: ".env.local" });
config({ path: ".env" });

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Add it to apps/api/.env first.");
  process.exit(1);
}

const pool = new Pool(poolOptionsFor(url));
const db = drizzle(pool, { schema });

/** The same tag the story seeder uses, so one wipe clears both. */
const TAG = "[demo]";

/* -------------------------------------------------------------------------- */
/*  Deterministic randomness                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A seeded generator, so a second run produces identical figures.
 *
 * With Math.random, "the dashboard total changed" would mean nothing — it
 * changes every reload. Here it means somebody changed the code.
 */
let seed = 20260820;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
const pick = <T>(list: readonly T[]): T =>
  list[Math.floor(rnd() * list.length)];
const between = (lo: number, hi: number) => Math.floor(rnd() * (hi - lo)) + lo;
const money = (lo: number, hi: number) => (between(lo, hi) * 100).toFixed(2);

/** ISO date, `days` before 20 August 2026. */
function dayBefore(days: number): string {
  const d = new Date(Date.UTC(2026, 7, 20));
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/*  Wipe                                                                        */
/* -------------------------------------------------------------------------- */

async function wipe() {
  console.log("\nRemoving the bulk data\n");

  const tagged = `%${TAG}%`;

  const demoSubs = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(like(subscriptions.notes, tagged));
  const subIds = demoSubs.map((s) => s.id);

  const steps: [string, () => Promise<{ rowCount: number | null }>][] = [
    [
      "subscription seats",
      () =>
        subIds.length
          ? db
              .delete(subscriptionUsers)
              .where(inArray(subscriptionUsers.subscriptionId, subIds))
          : noop(),
    ],
    [
      "subscriptions",
      () => db.delete(subscriptions).where(like(subscriptions.notes, tagged)),
    ],
    [
      "exchange rates",
      () => db.delete(fxRates).where(like(fxRates.notes, tagged)),
    ],
    [
      "sign-ins",
      // By email rather than by a tag: `users` has no notes column, and an
      // address nobody outside this file writes is the safest handle there is.
      () =>
        db.delete(users).where(like(users.email, "%@demo.sharevirals.test")),
    ],
  ];

  for (const [label, run] of steps) {
    const result = await run();
    if (result.rowCount) console.log(`  removed ${result.rowCount} ${label}`);
  }

  console.log(
    "\nRun `npm run db:demo -- wipe` as well — it owns the accounts,\n" +
      "team, transactions, payroll and challans this script added to.\n",
  );
}

function noop() {
  return Promise.resolve({ rowCount: 0 });
}

/* -------------------------------------------------------------------------- */
/*  Load                                                                        */
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
];
const DESIGNATIONS = [
  "Software Engineer",
  "Senior Software Engineer",
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
];
const DEPARTMENTS = [
  "Engineering",
  "Design",
  "Marketing",
  "Finance",
  "People",
  "Operations",
];

const TOOLS = [
  ["Claude", "Max plan", "ai_tool"],
  ["ChatGPT", "Team", "ai_tool"],
  ["Midjourney", "Standard", "ai_tool"],
  ["GitHub", "Team", "development"],
  ["Vercel", "Pro", "development"],
  ["Sentry", "Team", "development"],
  ["Linear", "Standard", "management"],
  ["Notion", "Plus", "productivity"],
  ["Slack", "Pro", "productivity"],
  ["Figma", "Organisation", "design"],
  ["Adobe CC", "All Apps", "design"],
  ["Canva", "Teams", "design"],
  ["Meta Ads", "Business", "marketing"],
  ["Google Ads", "Business", "marketing"],
  ["Ahrefs", "Standard", "marketing"],
  ["Buffer", "Team", "marketing"],
  ["BambooHR", "Essentials", "hr"],
  ["Deel", "Standard", "hr"],
  ["Airalo", "Data plan", "esim"],
  ["Hetzner", "CX32", "server_support"],
  ["DigitalOcean", "Droplets", "server_support"],
  ["Cloudflare", "Business", "server_support"],
  ["Xero", "Growing", "finance"],
  ["Wise", "Business", "finance"],
  ["Zoom", "Business", "productivity"],
  ["Loom", "Business", "productivity"],
  ["Grammarly", "Business", "productivity"],
  ["Postman", "Team", "development"],
  ["Datadog", "Pro", "server_support"],
  ["Intercom", "Advanced", "marketing"],
] as const;

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

const SPEND = [
  "Office rent",
  "Electricity",
  "Internet",
  "Office supplies",
  "Tea and snacks",
  "Courier",
  "Cleaning",
  "Water",
  "Generator fuel",
  "Server hosting",
  "Domain renewal",
  "Facebook ads",
  "Google ads",
  "Printing",
  "Repairs",
  "Staff lunch",
  "Mobile bills",
  "Travel",
  "Training",
  "Legal fees",
  "Audit fees",
  "Bank charges",
  "Equipment",
  "Furniture",
  "Software licence",
];

async function load() {
  const [actor] = await db.select({ id: users.id }).from(users).limit(1);
  if (!actor) {
    console.error(
      "No users yet. Run `npm run db:seed` first — everything here is\n" +
        "recorded as having been entered by somebody.",
    );
    process.exit(1);
  }

  const stamp = { createdBy: actor.id, updatedBy: actor.id };

  /* --- accounts ---------------------------------------------------------- */

  const existingAccounts = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts);

  const wantAccounts = [
    ["City Bank — current", "bank", "City Bank"],
    ["BRAC Bank — payroll", "bank", "BRAC Bank"],
    ["Dutch-Bangla — savings", "bank", "Dutch-Bangla Bank"],
    ["bKash merchant", "mobile_wallet", "bKash"],
    ["Nagad merchant", "mobile_wallet", "Nagad"],
    ["Office petty cash", "cash", null],
  ] as const;

  const madeAccounts: { id: string; name: string }[] = [];
  for (const [name, type, bank] of wantAccounts) {
    const found = existingAccounts.find((a) => a.name === name);
    if (found) {
      madeAccounts.push(found);
      continue;
    }
    const [row] = await db
      .insert(accounts)
      .values({
        name,
        type: type,
        bankName: bank,
        currency: "BDT",
        openingBalance: money(2000, 40000),
        openingBalanceOn: dayBefore(400),
        notes: `Bulk sample account ${TAG}`,
        ...stamp,
      })
      .returning({ id: accounts.id, name: accounts.name });
    madeAccounts.push(row);
  }
  console.log(`  accounts        ${madeAccounts.length}`);

  /* --- categories, with sub-categories ------------------------------------ */

  const outCats = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(
      and(eq(categories.kind, "out"), sql`${categories.parentId} is null`),
    );

  console.log(`  categories      ${outCats.length} headings already there`);

  const allCats = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.kind, "out"));

  /* --- team --------------------------------------------------------------- */

  const before = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(like(teamMembers.notes, `%${TAG}%`));

  const members: { id: string; name: string }[] = [];
  if (before.length < 25) {
    for (let i = 0; i < 32; i += 1) {
      const name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
      const [row] = await db
        .insert(teamMembers)
        .values({
          fullName: name,
          engagementType: i % 7 === 0 ? "contractor" : "employee",
          status:
            i % 11 === 0 ? "resigned" : i % 9 === 0 ? "on_leave" : "active",
          designation: pick(DESIGNATIONS),
          department: pick(DEPARTMENTS),
          joinedOn: dayBefore(between(30, 900)),
          endedOn: i % 11 === 0 ? dayBefore(between(5, 60)) : null,
          phone: `01${between(3, 9)}${between(10000000, 99999999)}`,
          workEmail: `${name.split(" ")[0].toLowerCase()}${i}@demo.sharevirals.test`,
          notes: `Bulk sample ${TAG}`,
          ...stamp,
        })
        .returning({ id: teamMembers.id, fullName: teamMembers.fullName });
      members.push({ id: row.id, name: row.fullName });

      await db.insert(compensationHistory).values({
        teamMemberId: row.id,
        grossAmount: money(250, 1800),
        effectiveFrom: dayBefore(between(30, 700)),
        changeReason: "Bulk sample",
        ...stamp,
      });
    }
  } else {
    const rows = await db
      .select({ id: teamMembers.id, fullName: teamMembers.fullName })
      .from(teamMembers)
      .where(like(teamMembers.notes, `%${TAG}%`));
    members.push(...rows.map((r) => ({ id: r.id, name: r.fullName })));
  }
  console.log(`  team            ${members.length}`);

  /* --- transactions ------------------------------------------------------- */

  const [{ count: txnCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(like(transactions.notes, `%${TAG}%`));

  if (txnCount < 100) {
    let n = 0;
    for (let i = 0; i < 240; i += 1) {
      const account = pick(madeAccounts);
      const inbound = i % 12 === 0;
      const day = dayBefore(between(1, 330));
      const amount = inbound ? money(80000, 300000) : money(300, 90000);
      const rate = (118 + rnd() * 8).toFixed(6);
      const cat = pick(allCats);

      await db.insert(transactions).values({
        refNo: `TXN-BULK-${String(i + 1).padStart(5, "0")}`,
        accountId: account.id,
        direction: inbound ? "in" : "out",
        txnDate: day,
        amount,
        categoryId: inbound ? null : cat.id,
        description: inbound
          ? `Funding from CEO — ${day.slice(0, 7)}`
          : `${pick(SPEND)} — ${day.slice(0, 7)}`,
        paymentMethod: pick([
          "bank_transfer",
          "cash",
          "card",
          "mobile_banking",
        ] as const),
        reference: `BNK${between(100000, 999999)}`,
        invoiceNo: i % 3 === 0 ? `INV-${between(1000, 9999)}` : null,
        senderAccountName: inbound ? "ShareViral Corp" : null,
        usdRate: rate,
        // All three together or none: `transactions_fx_complete` refuses a
        // foreign amount with no rate to have converted it, which is the right
        // rule — a figure in dollars that cannot say what it was worth is not
        // a record of anything.
        originalAmount: inbound
          ? (Number(amount) / Number(rate)).toFixed(2)
          : null,
        originalCurrency: inbound ? "USD" : null,
        fxRate: inbound ? rate : null,
        // A handful are voided on purpose: a screen that has never rendered a
        // struck-through row has never been checked for one.
        voidedAt: i % 23 === 0 ? new Date() : null,
        voidReason: i % 23 === 0 ? "Duplicate entry, bulk sample" : null,
        voidedBy: i % 23 === 0 ? actor.id : null,
        notes: `Bulk sample ${TAG}`,
        ...stamp,
      });
      n += 1;
    }
    console.log(`  transactions    ${n}`);
  } else {
    console.log(`  transactions    ${txnCount} already there`);
  }

  /* --- subscriptions ------------------------------------------------------ */

  const subs = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(like(subscriptions.notes, `%${TAG}%`));

  if (subs.length < 20) {
    // Two passes over the tool list, the second on a yearly cycle, so the
    // register has more than a page of live plans without inventing sixty
    // different products.
    for (let i = 0; i < TOOLS.length * 2; i += 1) {
      const [tool, plan, category] = TOOLS[i % TOOLS.length];
      const second = i >= TOOLS.length;
      const usd = money(10, 400);
      const rate = (118 + rnd() * 8).toFixed(6);
      const start = dayBefore(between(60, 700));

      const [row] = await db
        .insert(subscriptions)
        .values({
          toolName: second ? `${tool} (annual)` : tool,
          // A plausible address, so the name on the register has somewhere to
          // go while somebody is looking at the sample data.
          websiteUrl: `https://${tool.toLowerCase().replace(/\W/g, "")}.com`,
          planName: plan,
          category,
          // Weighted so the Active tab — the one the screen opens on — has
          // more than a page in it. Twenty actives and a pager that never
          // appears is a pagination nobody can check.
          status:
            i % 13 === 0
              ? "canceled"
              : i % 11 === 0
                ? "paused"
                : i % 17 === 0
                  ? "expired"
                  : "active",
          costUsd: usd,
          costBdt: (Number(usd) * Number(rate)).toFixed(2),
          usdRate: rate,
          billingCycle: second ? "yearly" : "monthly",
          startDate: start,
          nextRenewalOn: dayBefore(-between(1, 60)),
          paymentMethod: "card",
          accountId: pick(madeAccounts).id,
          boughtFor: pick(DEPARTMENTS),
          loginEmail: `${tool.toLowerCase().replace(/\W/g, "")}@sharevirals.test`,
          notes: `Bulk sample ${TAG}`,
          ...stamp,
        })
        .returning({ id: subscriptions.id });

      // Seats, so the "who is on it" column has more than one name in it.
      const seats = between(1, 5);
      for (let s = 0; s < seats && members.length; s += 1) {
        await db
          .insert(subscriptionUsers)
          .values({
            subscriptionId: row.id,
            teamMemberId: pick(members).id,
            fromDate: start,
            status: "active",
            createdBy: actor.id,
          })
          .onConflictDoNothing();
      }
    }
    console.log(`  subscriptions   ${TOOLS.length * 2}`);
  } else {
    console.log(`  subscriptions   ${subs.length} already there`);
  }

  /* --- exchange rates ----------------------------------------------------- */

  const rates = await db
    .select({ id: fxRates.id })
    .from(fxRates)
    .where(like(fxRates.notes, `%${TAG}%`));

  if (rates.length < 20) {
    for (let i = 0; i < 45; i += 1) {
      await db
        .insert(fxRates)
        .values({
          baseCurrency: "USD",
          quoteCurrency: "BDT",
          rate: (117 + rnd() * 9).toFixed(6),
          rateDate: dayBefore(i * 7 + 1),
          source: "manual",
          notes: `Bulk sample ${TAG}`,
          ...stamp,
        })
        .onConflictDoNothing();
    }
    console.log(`  exchange rates  45`);
  } else {
    console.log(`  exchange rates  ${rates.length} already there`);
  }

  /* --- sign-ins ----------------------------------------------------------- */

  const signIns = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, "%@demo.sharevirals.test"));

  if (signIns.length < 20) {
    // A bcrypt hash of a password nobody is told, because nobody should sign in
    // as one of these. They exist so the table has rows to page through.
    const unusable =
      "$2b$12$0000000000000000000000000000000000000000000000000000";
    for (let i = 0; i < 26; i += 1) {
      const name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
      await db
        .insert(users)
        .values({
          email: `sample${i}@demo.sharevirals.test`,
          fullName: name,
          passwordHash: unusable,
          role: pick(["admin", "finance", "hr", "ceo"] as const),
          status: i % 8 === 0 ? "disabled" : "active",
          lastLoginAt: i % 3 === 0 ? new Date() : null,
        })
        .onConflictDoNothing();
    }
    console.log(`  sign-ins        26`);
  } else {
    console.log(`  sign-ins        ${signIns.length} already there`);
  }

  /* --- payroll runs ------------------------------------------------------- */

  const runs = await db
    .select({ id: payrollRuns.id })
    .from(payrollRuns)
    .where(like(payrollRuns.notes, `%${TAG}%`));

  if (runs.length < 20 && members.length) {
    let made = 0;
    for (let back = 0; back < 26; back += 1) {
      const month = ((((7 - back) % 12) + 12) % 12) + 1;
      const year = 2026 - Math.floor((back + 4) / 12);

      const [run] = await db
        .insert(payrollRuns)
        .values({
          periodYear: year,
          periodMonth: month,
          label: `${MONTHS[month - 1]} ${year}`,
          status: back === 0 ? "draft" : back < 3 ? "finalized" : "paid",
          notes: `Bulk sample ${TAG}`,
          ...stamp,
        })
        .onConflictDoNothing()
        .returning({ id: payrollRuns.id });

      if (!run) continue;
      made += 1;

      for (const member of members.slice(0, 18)) {
        const gross = money(250, 1600);
        await db.insert(payrollLines).values({
          payrollRunId: run.id,
          teamMemberId: member.id,
          grossAmount: gross,
          tdsAmount: (Number(gross) * 0.03).toFixed(2),
          bonusAmount: "0.00",
          otherAdditions: "0.00",
          otherDeductions: "0.00",
          snapshotDesignation: pick(DESIGNATIONS),
          snapshotDepartment: pick(DEPARTMENTS),
          ...stamp,
        });
      }
    }
    console.log(`  payroll runs    ${made}`);
  } else {
    console.log(`  payroll runs    ${runs.length} already there`);
  }

  /* --- challans ----------------------------------------------------------- */

  const challans = await db
    .select({ id: tdsDeposits.id })
    .from(tdsDeposits)
    .where(like(tdsDeposits.notes, `%${TAG}%`));

  if (challans.length < 20) {
    for (let i = 0; i < 28; i += 1) {
      await db
        .insert(tdsDeposits)
        .values({
          challanNumber: `A-2026${String(between(100000, 999999))}`,
          challanDate: dayBefore(i * 11 + 3),
          depositDate: dayBefore(i * 11 + 3),
          // The month whose deductions this challan covers, which is what the
          // deposit deadline is counted from — not the day it was paid.
          periodYear: 2026 - Math.floor(i / 12),
          periodMonth: ((((7 - i) % 12) + 12) % 12) + 1,
          amount: money(500, 9000),
          bankName: pick(["Sonali Bank", "Janata Bank", "City Bank"]),
          notes: `Bulk sample ${TAG}`,
          ...stamp,
        })
        .onConflictDoNothing();
    }
    console.log(`  challans        28`);
  } else {
    console.log(`  challans        ${challans.length} already there`);
  }

  console.log("\nLoaded. Every table now has more than one page.\n");
}

/* -------------------------------------------------------------------------- */

const mode = process.argv[2];
(mode === "wipe" ? wipe() : load())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

/**
 * Seeds a starting category tree.
 *
 *   npm run db:seed-categories
 *
 * These are a proposal, not a fixture — rename, recolour, deactivate, or add
 * to them from Settings. Two levels only, because a third dropdown at the
 * moment of recording a payment reliably produces money filed under the wrong
 * heading.
 *
 * Existing categories are left alone, so re-running is safe.
 */

import { slugify } from "@finance/shared";
import { config } from "dotenv";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { poolOptionsFor } from "./connection";
import * as schema from "./schema";
import { auditLogs, categories } from "./schema";

config({ path: ".env.local" });
config({ path: ".env" });

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Add it to apps/api/.env first.");
  process.exit(1);
}

const pool = new Pool(poolOptionsFor(url));
const db = drizzle(pool, { schema });

type Group = {
  name: string;
  kind: "in" | "out";
  color: string;
  children: string[];
};

// Colours are the chart palette from globals.css, so a donut slice and its
// breakdown page always agree.
const TREE: Group[] = [
  {
    name: "Office & premises",
    kind: "out",
    color: "#4f46e5",
    children: [
      "Office rent",
      "Electricity",
      "Water & gas",
      "Internet",
      "Cleaning & maintenance",
      "Security",
    ],
  },
  {
    name: "People",
    kind: "out",
    color: "#0ea5e9",
    children: [
      // "Salary" is looked up by name when payroll posts a run. Renaming it
      // is allowed and safe — the lookup falls back to the first money-out
      // heading — but the fallback is a guess, and a guess is how a month of
      // salary ends up under Office rent. Rename with that in mind.
      "Salary",
      "Bonus",
      // Two Eid bonuses a year is the norm here and is a separate line in
      // every set of books this company will be asked for.
      "Festival bonus",
      "Overtime",
      "Provident fund",
      "Leave encashment",
      "Contractor payment",
      "Recruitment",
      "Training",
      "Staff welfare",
    ],
  },
  {
    name: "Technology",
    kind: "out",
    color: "#0d9488",
    children: [
      "Software & subscriptions",
      // Its own line rather than part of software: this company runs a whole
      // screen for AI tools, and a spend it tracks per seat deserves to be
      // readable on its own in the reports.
      "AI tools",
      "Hosting & servers",
      "Domains",
      "Hardware & equipment",
      "Development & maintenance",
    ],
  },
  {
    name: "Marketing",
    kind: "out",
    color: "#d97706",
    children: [
      "Advertising",
      "Content & design",
      "Agency & freelancers",
      "Sponsorship",
      "Events",
    ],
  },
  {
    name: "Administrative",
    kind: "out",
    color: "#db2777",
    children: [
      "Professional fees",
      "Legal & compliance",
      "Government fees & licences",
      "Bank charges",
      "Insurance",
      "Office supplies",
      "Courier & postage",
      "Repairs & servicing",
      "Travel & transport",
      "Food & hospitality",
    ],
  },
  {
    name: "Tax",
    kind: "out",
    color: "#7c3aed",
    children: [
      // Looked up by name when a challan is recorded, the same way "Salary"
      // is. Same caution applies.
      "TDS deposit",
      "VAT",
      "Withholding VAT",
      "Advance tax",
      "Income tax",
      "Customs & duty",
    ],
  },
  {
    // Borrowing costs are not an administrative expense and reading them as
    // one hides what the company actually pays to be financed.
    name: "Finance",
    kind: "out",
    color: "#b45309",
    children: ["Loan repayment", "Interest paid", "Exchange loss"],
  },
  {
    name: "Other expenses",
    kind: "out",
    color: "#5b6472",
    children: [],
  },
  {
    name: "Money in",
    kind: "in",
    color: "#047857",
    children: [
      "CEO funding",
      "Client receipts",
      "Loan received",
      "Investment received",
      "Interest income",
      "Exchange gain",
      "Refunds",
      "Other income",
    ],
  },
];

async function findExisting(slug: string, parentId: string | null) {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.slug, slug),
        parentId
          ? eq(categories.parentId, parentId)
          : isNull(categories.parentId),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

async function main() {
  let created = 0;
  let skipped = 0;

  for (const [groupIndex, group] of TREE.entries()) {
    const parentSlug = slugify(group.name);
    let parentId = await findExisting(parentSlug, null);

    if (parentId) {
      skipped++;
    } else {
      const [row] = await db
        .insert(categories)
        .values({
          name: group.name,
          slug: parentSlug,
          kind: group.kind,
          color: group.color,
          sortOrder: groupIndex * 10,
          isSystem: true,
        })
        .returning({ id: categories.id });
      parentId = row.id;
      created++;
    }

    for (const [childIndex, childName] of group.children.entries()) {
      const childSlug = slugify(childName);
      const existing = await findExisting(childSlug, parentId);
      if (existing) {
        skipped++;
        continue;
      }
      await db.insert(categories).values({
        name: childName,
        slug: childSlug,
        kind: group.kind,
        parentId,
        color: group.color,
        sortOrder: childIndex * 10,
        isSystem: true,
      });
      created++;
    }

    const marker = group.kind === "in" ? "in " : "out";
    console.log(
      `  [${marker}] ${group.name}${group.children.length ? ` — ${group.children.length} sub-categories` : ""}`,
    );
  }

  if (created > 0) {
    await db.insert(auditLogs).values({
      action: "create",
      entityTable: "categories",
      summary: `Seeded the starting category tree (${created} categories)`,
      module: "seed",
    });
  }

  console.log(
    `\n${created} created, ${skipped} already existed. Edit them in Settings → Categories.\n`,
  );
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error("Category seed failed:", error);
    await pool.end();
    process.exit(1);
  });

/**
 * Loads a made-up but realistic July–August 2026 so every screen has something
 * on it before the real numbers arrive.
 *
 *   npm run db:demo         load it
 *   npm run db:demo -- wipe remove it again
 *
 * Everything it creates is tagged, and `wipe` removes exactly that tag — your
 * own entries are never touched. Users and categories are left alone either
 * way.
 *
 * This is scaffolding for looking at the app, not a fixture to build on. Wipe
 * it before the first real transaction goes in.
 */

import { config } from "dotenv";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { poolOptionsFor } from "./connection";
import * as schema from "./schema";
import {
  accounts,
  auditLogs,
  categories,
  compensationHistory,
  incomeTaxRecords,
  payrollLines,
  payrollRuns,
  tdsAllocations,
  tdsDeposits,
  teamMembers,
  transactions,
  users,
  vendors,
  withholdingReturns,
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

/** Everything this script creates carries this, so wiping is exact. */
const TAG = "[demo]";

/* -------------------------------------------------------------------------- */

async function wipe() {
  console.log("\nRemoving the demo data\n");

  const demoAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(like(accounts.notes, `%${TAG}%`));
  const demoMembers = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(like(teamMembers.notes, `%${TAG}%`));

  const accountIds = demoAccounts.map((a) => a.id);
  const memberIds = demoMembers.map((m) => m.id);

  // Children first, and anything holding a transaction reference before the
  // transactions themselves.
  const steps: Array<[string, () => Promise<{ rowCount: number | null }>]> = [
    [
      "tds allocations",
      () =>
        db.delete(tdsAllocations).where(
          sql`${tdsAllocations.depositId} in (
            select id from ${tdsDeposits} where ${tdsDeposits.notes} like ${`%${TAG}%`}
          )`,
        ),
    ],
    [
      "challans",
      () => db.delete(tdsDeposits).where(like(tdsDeposits.notes, `%${TAG}%`)),
    ],
    [
      "withholding returns",
      () =>
        db
          .delete(withholdingReturns)
          .where(like(withholdingReturns.notes, `%${TAG}%`)),
    ],
    [
      "income tax records",
      () =>
        db
          .delete(incomeTaxRecords)
          .where(like(incomeTaxRecords.notes, `%${TAG}%`)),
    ],
    [
      "payroll lines",
      () =>
        db.delete(payrollLines).where(
          sql`${payrollLines.payrollRunId} in (
            select id from ${payrollRuns} where ${payrollRuns.notes} like ${`%${TAG}%`}
          )`,
        ),
    ],
    [
      "payroll runs",
      () => db.delete(payrollRuns).where(like(payrollRuns.notes, `%${TAG}%`)),
    ],
    [
      "compensation",
      () =>
        memberIds.length
          ? db
              .delete(compensationHistory)
              .where(inArray(compensationHistory.teamMemberId, memberIds))
          : noop(),
    ],
    [
      "transactions",
      () =>
        accountIds.length
          ? db
              .delete(transactions)
              .where(inArray(transactions.accountId, accountIds))
          : noop(),
    ],
    [
      "team members",
      () => db.delete(teamMembers).where(like(teamMembers.notes, `%${TAG}%`)),
    ],
    [
      "accounts",
      () => db.delete(accounts).where(like(accounts.notes, `%${TAG}%`)),
    ],
    [
      "vendors",
      () => db.delete(vendors).where(like(vendors.notes, `%${TAG}%`)),
    ],
  ];

  for (const [label, run] of steps) {
    const result = await run();
    if (result.rowCount) console.log(`  removed ${result.rowCount} ${label}`);
  }

  await db
    .delete(auditLogs)
    .where(eq(auditLogs.module, "demo"))
    .catch(() => undefined);

  console.log("\nGone. Your own entries were not touched.\n");
}

function noop() {
  return Promise.resolve({ rowCount: 0 });
}

/* -------------------------------------------------------------------------- */

async function load() {
  const [existing] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(like(accounts.notes, `%${TAG}%`))
    .limit(1);

  if (existing) {
    console.log(
      "\nThe demo data is already loaded. Run `npm run db:demo -- wipe` first.\n",
    );
    return;
  }

  const [actor] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "super_admin"))
    .limit(1);
  const by = actor?.id ?? null;

  console.log("\nLoading a demo July–August 2026\n");

  /* --- where the money sits ---------------------------------------------- */

  const [bank] = await db
    .insert(accounts)
    .values({
      name: "City Bank — Gulshan (demo)",
      type: "bank",
      accountNumber: "1502734556001",
      currency: "BDT",
      openingBalance: "1850000.00",
      openingBalanceOn: "2026-06-30",
      notes: `Made-up account for looking around. ${TAG}`,
      createdBy: by,
      updatedBy: by,
    })
    .returning();

  const [cash] = await db
    .insert(accounts)
    .values({
      name: "Petty cash (demo)",
      type: "cash",
      currency: "BDT",
      openingBalance: "40000.00",
      openingBalanceOn: "2026-06-30",
      sortOrder: 1,
      notes: `Made-up account for looking around. ${TAG}`,
      createdBy: by,
      updatedBy: by,
    })
    .returning();

  console.log("  2 accounts — ৳18,50,000 in the bank, ৳40,000 petty cash");

  /* --- who is paid -------------------------------------------------------- */

  const vendorRows = [
    { name: "Beacon Properties Ltd", type: "landlord", etin: "417029385512" },
    { name: "Grameenphone", type: "utility", etin: "104582930017" },
    { name: "Amazon Web Services", type: "supplier", etin: null },
    { name: "Rahman Traders", type: "supplier", etin: "553918274460" },
    { name: "Sadia Printing Press", type: "supplier", etin: null },
  ] as const;

  const vendorIds: Record<string, string> = {};
  for (const row of vendorRows) {
    const [created] = await db
      .insert(vendors)
      .values({
        name: row.name,
        type: row.type,
        etin: row.etin,
        psrStatus: row.etin ? "submitted" : "unknown",
        notes: `Made-up vendor. ${TAG}`,
        createdBy: by,
        updatedBy: by,
      })
      .returning({ id: vendors.id });
    vendorIds[row.name] = created.id;
  }
  console.log(`  ${vendorRows.length} vendors`);

  /* --- the team ----------------------------------------------------------- */

  const team = [
    [
      "SV-001",
      "Tanvir Ahmed",
      "Engineering",
      "Lead Engineer",
      "2024-02-01",
      "95000.00",
      "6500.00",
    ],
    [
      "SV-002",
      "Nusrat Jahan",
      "Design",
      "Product Designer",
      "2024-08-15",
      "68000.00",
      "3200.00",
    ],
    [
      "SV-003",
      "Rakibul Hasan",
      "Engineering",
      "Backend Engineer",
      "2025-01-05",
      "72000.00",
      "3800.00",
    ],
    [
      "SV-004",
      "Farhana Islam",
      "Marketing",
      "Growth Lead",
      "2025-03-10",
      "60000.00",
      "2400.00",
    ],
    [
      "SV-005",
      "Imran Kabir",
      "Operations",
      "Operations Manager",
      "2023-11-20",
      "55000.00",
      "1900.00",
    ],
    [
      "SV-006",
      "Sumaiya Akter",
      "Finance",
      "Accounts Officer",
      "2025-06-01",
      "45000.00",
      "900.00",
    ],
  ] as const;

  const memberIds: Array<{ id: string; gross: string; tds: string }> = [];
  for (const [code, name, dept, title, joined, gross, tds] of team) {
    const [member] = await db
      .insert(teamMembers)
      .values({
        employeeCode: code,
        fullName: name,
        engagementType: "employee",
        department: dept,
        designation: title,
        joinedOn: joined,
        status: "active",
        workEmail: `${code.toLowerCase()}@shareviral.cash`,
        bankName: "City Bank",
        bankAccountNumber: `15027${code.slice(-3)}0099`,
        psrStatus: Number(gross) >= 16000 ? "submitted" : "unknown",
        psrAssessmentYear: "2026-2027",
        notes: `Made-up employee. ${TAG}`,
        createdBy: by,
        updatedBy: by,
      })
      .returning({ id: teamMembers.id });

    await db.insert(compensationHistory).values({
      teamMemberId: member.id,
      grossAmount: gross,
      effectiveFrom: joined,
      changeReason: "Starting salary",
      createdBy: by,
    });

    memberIds.push({ id: member.id, gross, tds });
  }

  // One contractor, to show that contractors stay off the salary sheet and are
  // paid as ordinary ledger rows.
  await db
    .insert(teamMembers)
    .values({
      employeeCode: "SV-C01",
      fullName: "Arif Chowdhury",
      engagementType: "contractor",
      designation: "Video Editor",
      joinedOn: "2026-04-01",
      status: "active",
      notes: `Made-up contractor — paid per job, not on the salary sheet. ${TAG}`,
      createdBy: by,
      updatedBy: by,
    })
    .returning({ id: teamMembers.id });

  console.log("  6 employees + 1 contractor");

  /* --- the categories the demo rows use ----------------------------------- */

  const catId = async (name: string) => {
    const [row] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          sql`lower(${categories.name}) = ${name.toLowerCase()}`,
          eq(categories.isActive, true),
        ),
      )
      .limit(1);
    return row?.id ?? null;
  };

  const cat = {
    funding: await catId("CEO funding"),
    rent: await catId("Office rent"),
    internet: await catId("Internet"),
    software: await catId("Software & subscriptions"),
    supplies: await catId("Office supplies"),
    marketing: await catId("Advertising"),
    contractor: await catId("Contractor payment"),
    salary: await catId("Salary"),
    tds: await catId("TDS deposit"),
    utility: await catId("Electricity"),
    travel: await catId("Travel & transport"),
  };

  const missing = Object.entries(cat)
    .filter(([, id]) => !id)
    .map(([key]) => key);
  if (missing.length) {
    console.log(
      `  note: no category found for ${missing.join(", ")} — run npm run db:seed-categories first if you want them grouped`,
    );
  }

  /* --- a month of movement ------------------------------------------------ */

  let sequence = 0;
  const ref = (date: string) => {
    sequence += 1;
    return `TXN-${date.slice(0, 4)}-${String(sequence).padStart(6, "0")}`;
  };

  type Row = {
    date: string;
    dir: "in" | "out";
    amount: string;
    desc: string;
    category: string | null;
    vendor?: string;
    account?: string;
    method?: "bank_transfer" | "cash" | "mobile_banking" | "cheque" | "card";
    withheld?: string;
    bill?: string;
    usd?: string;
    rate?: string;
  };

  const rows: Row[] = [
    // The CEO's remittance — the one place USD is a fact rather than a view.
    {
      date: "2026-07-02",
      dir: "in",
      amount: "1180000.00",
      desc: "Funding from CEO — July",
      category: cat.funding,
      usd: "10000.00",
      rate: "118.00",
    },
    {
      date: "2026-07-03",
      dir: "out",
      amount: "85000.00",
      desc: "Office rent — July",
      category: cat.rent,
      vendor: "Beacon Properties Ltd",
      withheld: "4500.00",
      bill: "89500.00",
    },
    {
      date: "2026-07-05",
      dir: "out",
      amount: "6200.00",
      desc: "Office internet — July",
      category: cat.internet,
      vendor: "Grameenphone",
    },
    {
      date: "2026-07-08",
      dir: "out",
      amount: "31400.00",
      desc: "AWS — June usage",
      category: cat.software,
      vendor: "Amazon Web Services",
      method: "card",
    },
    {
      date: "2026-07-12",
      dir: "out",
      amount: "4800.00",
      desc: "Stationery and printer paper",
      category: cat.supplies,
      vendor: "Rahman Traders",
      account: "cash",
    },
    {
      date: "2026-07-15",
      dir: "out",
      amount: "45000.00",
      desc: "Facebook ads — July campaign",
      category: cat.marketing,
      method: "card",
    },
    {
      date: "2026-07-18",
      dir: "out",
      amount: "18000.00",
      desc: "Promo video edit",
      category: cat.contractor,
      withheld: "1800.00",
      bill: "19800.00",
    },
    {
      date: "2026-07-22",
      dir: "out",
      amount: "9700.00",
      desc: "Electricity — July",
      category: cat.utility,
    },
    {
      date: "2026-07-25",
      dir: "out",
      amount: "3200.00",
      desc: "Client meeting transport",
      category: cat.travel,
      account: "cash",
    },
    {
      date: "2026-07-28",
      dir: "out",
      amount: "12500.00",
      desc: "Business cards and brochures",
      category: cat.supplies,
      vendor: "Sadia Printing Press",
    },

    {
      date: "2026-08-01",
      dir: "in",
      amount: "1183000.00",
      desc: "Funding from CEO — August",
      category: cat.funding,
      usd: "10000.00",
      rate: "118.30",
    },
    {
      date: "2026-08-03",
      dir: "out",
      amount: "85000.00",
      desc: "Office rent — August",
      category: cat.rent,
      vendor: "Beacon Properties Ltd",
      withheld: "4500.00",
      bill: "89500.00",
    },
    {
      date: "2026-08-05",
      dir: "out",
      amount: "6200.00",
      desc: "Office internet — August",
      category: cat.internet,
      vendor: "Grameenphone",
    },
    {
      date: "2026-08-06",
      dir: "out",
      amount: "28900.00",
      desc: "AWS — July usage",
      category: cat.software,
      vendor: "Amazon Web Services",
      method: "card",
    },
    {
      date: "2026-08-09",
      dir: "out",
      amount: "5600.00",
      desc: "Tea, coffee and pantry",
      category: cat.supplies,
      account: "cash",
    },
    {
      date: "2026-08-11",
      dir: "out",
      amount: "38000.00",
      desc: "Google ads — August",
      category: cat.marketing,
      method: "card",
    },
    {
      date: "2026-08-12",
      dir: "out",
      amount: "10400.00",
      desc: "Electricity — August",
      category: cat.utility,
    },
  ];

  for (const row of rows) {
    await db.insert(transactions).values({
      refNo: ref(row.date),
      accountId: row.account === "cash" ? cash.id : bank.id,
      direction: row.dir,
      txnDate: row.date,
      amount: row.amount,
      categoryId: row.category,
      vendorId: row.vendor ? vendorIds[row.vendor] : null,
      paymentMethod:
        row.method ?? (row.account === "cash" ? "cash" : "bank_transfer"),
      description: `${row.desc} ${TAG}`,
      billAmount: row.bill ?? null,
      withheldTaxAmount: row.withheld ?? "0",
      originalAmount: row.usd ?? null,
      originalCurrency: row.usd ? "USD" : null,
      fxRate: row.rate ?? null,
      fxRateSource: row.rate ? "manual" : null,
      createdVia: "manual",
      createdBy: by,
      updatedBy: by,
    });
  }
  console.log(`  ${rows.length} transactions across July and August`);

  /* --- July's payroll, paid ----------------------------------------------- */

  const totals = memberIds.reduce(
    (acc, m) => ({
      gross: acc.gross + Number(m.gross),
      tds: acc.tds + Number(m.tds),
    }),
    { gross: 0, tds: 0 },
  );
  const net = totals.gross - totals.tds;

  const [julyRun] = await db
    .insert(payrollRuns)
    .values({
      periodYear: 2026,
      periodMonth: 7,
      label: "July 2026",
      status: "paid",
      paymentMode: "consolidated",
      accountId: bank.id,
      paymentDate: "2026-07-31",
      paymentMethod: "bank_transfer",
      totalGross: totals.gross.toFixed(2),
      totalTds: totals.tds.toFixed(2),
      totalNet: net.toFixed(2),
      notes: `Made-up payroll run. ${TAG}`,
      finalizedAt: new Date("2026-07-30T10:00:00Z"),
      finalizedBy: by,
      createdBy: by,
      updatedBy: by,
    })
    .returning();

  const [salaryTxn] = await db
    .insert(transactions)
    .values({
      refNo: ref("2026-07-31"),
      accountId: bank.id,
      direction: "out",
      txnDate: "2026-07-31",
      amount: net.toFixed(2),
      categoryId: cat.salary,
      description: `Salary — July 2026 ${TAG}`,
      paymentMethod: "bank_transfer",
      createdVia: "payroll",
      payrollRunId: julyRun.id,
      createdBy: by,
      updatedBy: by,
    })
    .returning({ id: transactions.id });

  const julyLineIds: string[] = [];
  for (const member of memberIds) {
    const [line] = await db
      .insert(payrollLines)
      .values({
        payrollRunId: julyRun.id,
        teamMemberId: member.id,
        grossAmount: member.gross,
        tdsAmount: member.tds,
        isPaid: true,
        paidOn: "2026-07-31",
        transactionId: salaryTxn.id,
      })
      .returning({ id: payrollLines.id });
    julyLineIds.push(line.id);
  }

  console.log(
    `  July payroll: gross ৳${totals.gross.toLocaleString("en-IN")}, tax ৳${totals.tds.toLocaleString("en-IN")}, net paid ৳${net.toLocaleString("en-IN")}`,
  );

  /* --- August's payroll, still a draft ------------------------------------ */

  const [augustRun] = await db
    .insert(payrollRuns)
    .values({
      periodYear: 2026,
      periodMonth: 8,
      label: "August 2026",
      status: "draft",
      paymentMode: "consolidated",
      totalGross: totals.gross.toFixed(2),
      totalTds: "0",
      totalNet: totals.gross.toFixed(2),
      notes: `Made-up payroll run, deliberately left unfinished. ${TAG}`,
      createdBy: by,
      updatedBy: by,
    })
    .returning();

  for (const member of memberIds) {
    await db.insert(payrollLines).values({
      payrollRunId: augustRun.id,
      teamMemberId: member.id,
      grossAmount: member.gross,
      tdsAmount: "0",
    });
  }
  console.log(
    "  August payroll left as a draft, so there is something to finish",
  );

  /* --- the tax that follows from all that --------------------------------- */

  // July's salary tax went to the treasury on 12 August. The rent and the
  // contractor's tax did not — that gap is what the dashboard should be
  // shouting about.
  const [challan] = await db
    .insert(tdsDeposits)
    .values({
      challanNumber: "A-2026071142",
      challanDate: "2026-08-12",
      depositDate: "2026-08-12",
      amount: totals.tds.toFixed(2),
      bankName: "Sonali Bank",
      branch: "Ramna Corporate",
      periodYear: 2026,
      periodMonth: 7,
      depositType: "salary",
      accountId: bank.id,
      notes: `Made-up challan — covers July salary tax only. ${TAG}`,
      createdBy: by,
      updatedBy: by,
    })
    .returning();

  const [challanTxn] = await db
    .insert(transactions)
    .values({
      refNo: ref("2026-08-12"),
      accountId: bank.id,
      direction: "out",
      txnDate: "2026-08-12",
      amount: totals.tds.toFixed(2),
      categoryId: cat.tds,
      description: `TDS deposit — challan A-2026071142 (July 2026) ${TAG}`,
      reference: "A-2026071142",
      createdVia: "tax_payment",
      createdBy: by,
      updatedBy: by,
    })
    .returning({ id: transactions.id });

  await db
    .update(tdsDeposits)
    .set({ transactionId: challanTxn.id })
    .where(eq(tdsDeposits.id, challan.id));

  for (const [index, lineId] of julyLineIds.entries()) {
    await db.insert(tdsAllocations).values({
      depositId: challan.id,
      payrollLineId: lineId,
      amount: memberIds[index].tds,
    });
  }
  console.log(
    "  July salary tax deposited; the ৳6,300 withheld from rent and the contractor was not",
  );

  // Opening /tax/withholding creates these from the statutory calendar, so one
  // may already be here.
  await db
    .insert(withholdingReturns)
    .values({
      fiscalYear: 2026,
      quarter: 1,
      periodStart: "2026-07-01",
      periodEnd: "2026-09-30",
      dueDate: "2026-10-25",
      notes: `Made-up return. ${TAG}`,
    })
    .onConflictDoNothing();

  await db.insert(incomeTaxRecords).values([
    {
      assessmentYear: "2027-2028",
      incomeYearStart: "2026-07-01",
      incomeYearEnd: "2027-06-30",
      recordType: "advance_quarter",
      quarter: 1,
      dueDate: "2026-09-15",
      amountPayable: "175000.00",
      notes: `Made-up assessment. ${TAG}`,
      createdBy: by,
      updatedBy: by,
    },
    {
      assessmentYear: "2027-2028",
      incomeYearStart: "2026-07-01",
      incomeYearEnd: "2027-06-30",
      recordType: "advance_quarter",
      quarter: 2,
      dueDate: "2026-12-15",
      amountPayable: "175000.00",
      notes: `Made-up assessment. ${TAG}`,
      createdBy: by,
      updatedBy: by,
    },
  ]);
  console.log(
    "  Q1 withholding return unfiled, two advance instalments assessed",
  );

  await db.insert(auditLogs).values({
    action: "import",
    entityTable: "accounts",
    summary: "Loaded the demo dataset",
    module: "demo",
  });

  console.log(`
Done. Sign in and look at:
  /                     the pending card should name what is overdue
  /accounts             two accounts with running balances
  /transactions         a month of in and out
  /expenses             the same money grouped by heading
  /payroll              July paid, August still a draft
  /tax/withholding      one challan, and the gap it does not cover
  /tax/income-tax       the assessed instalments

Remove it all with:  npm run db:demo -- wipe
`);
}

/* -------------------------------------------------------------------------- */

const shouldWipe = process.argv.slice(2).includes("wipe");

(shouldWipe ? wipe() : load())
  .then(() => pool.end())
  .catch(async (error) => {
    console.error("\nDemo seed failed:", error);
    await pool.end();
    process.exit(1);
  });

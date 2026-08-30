import type Anthropic from "@anthropic-ai/sdk";
import { Injectable } from "@nestjs/common";
import {
  formatMoney,
  hasPermission,
  todayInDhaka,
  type Permission,
} from "@finance/shared";
import { and, desc, eq, gte, ilike, isNull, lte, or, sql } from "drizzle-orm";

import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import { CHALLAN_COUNTS } from "../tds/challan-counts";
import { notATransfer } from "../transactions/own-money";
import {
  accounts,
  categories,
  incomeTaxRecords,
  payrollLines,
  payrollRuns,
  tdsDeposits,
  teamMembers,
  transactions,
  vendors,
} from "../../db/schema";

/**
 * What the assistant is allowed to look up.
 *
 * Every tool is read-only and every tool is gated on the **signed-in person's**
 * permissions, not the assistant's. There is no service account and no
 * elevated path: asking the assistant a question can only ever return what the
 * person asking could have found by clicking. If HR asks what somebody earns,
 * the tool refuses for the same reason the screen would.
 *
 * That is the whole safety argument for giving it read access at all. Without
 * it, a chat box becomes the one door in the building with no lock.
 */

export type ToolResult = {
  ok: boolean;
  /** Rendered for the model to read. Money is already formatted. */
  text: string;
};

type ToolDefinition = {
  name: string;
  description: string;
  /** All of these are required before the tool will run. */
  requires: Permission[];
  input_schema: Anthropic.Tool["input_schema"];
};

const LIVE = isNull(transactions.voidedAt);

export const AI_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "find_transactions",
    description:
      "Search the ledger. Use for any question about what was spent, received, or paid to someone. Returns up to 100 entries, newest first.",
    requires: ["transactions.read"],
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "YYYY-MM-DD, inclusive" },
        to: { type: "string", description: "YYYY-MM-DD, inclusive" },
        direction: { type: "string", enum: ["in", "out"] },
        search: {
          type: "string",
          description: "Matches the description, the reference, or the vendor",
        },
        category: { type: "string", description: "A category name" },
      },
    },
  },
  {
    name: "account_balances",
    description:
      "Every account and what is in it right now. Use for 'how much do we have'.",
    requires: ["accounts.read"],
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "period_summary",
    description:
      "Money in, money out and the net for a date range, with the biggest spending headings. Use for 'how did we do in August'.",
    requires: ["transactions.read"],
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "YYYY-MM-DD" },
        to: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "tax_status",
    description:
      "Withholding tax deducted, deposited and still held, month by month, plus the company income tax schedule. Use for anything about TDS, challans or tax deadlines.",
    requires: ["tds.read"],
    input_schema: {
      type: "object",
      properties: {
        year: { type: "number", description: "Calendar year, e.g. 2026" },
      },
    },
  },
  {
    name: "find_party",
    description:
      "Look up a vendor or a team member by name. For a team member this returns their role and joining date — never their pay.",
    requires: [],
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        kind: { type: "string", enum: ["vendor", "person"] },
      },
      required: ["name"],
    },
  },
  {
    name: "payroll_status",
    description:
      "Payroll runs and where each one has reached: draft, finalised or paid.",
    requires: ["payroll.read"],
    input_schema: {
      type: "object",
      properties: {
        year: { type: "number" },
      },
    },
  },
];

@Injectable()
export class AiToolsService {
  constructor(private readonly db: DbService) {}

  /** The tools this person may actually use. The model never sees the rest. */
  definitionsFor(actor: AuthenticatedUser) {
    return AI_TOOL_DEFINITIONS.filter((tool) =>
      tool.requires.every((permission) =>
        hasPermission(actor.role, permission),
      ),
    ).map(({ name, description, input_schema }) => ({
      name,
      description,
      input_schema,
    }));
  }

  async run(
    name: string,
    input: Record<string, unknown>,
    actor: AuthenticatedUser,
  ): Promise<ToolResult> {
    const definition = AI_TOOL_DEFINITIONS.find((t) => t.name === name);
    if (!definition) return { ok: false, text: `No tool called ${name}.` };

    // Checked again here, not only when the list was built. The model can
    // invent a tool name, and a permission check that happens once at the top
    // is one refactor away from not happening.
    const missing = definition.requires.filter(
      (permission) => !hasPermission(actor.role, permission),
    );
    if (missing.length) {
      return {
        ok: false,
        text: `Refused: this account does not have permission to see that (${missing.join(", ")}). Say so plainly and do not guess at the answer.`,
      };
    }

    switch (name) {
      case "find_transactions":
        return this.findTransactions(input);
      case "account_balances":
        return this.accountBalances();
      case "period_summary":
        return this.periodSummary(input);
      case "tax_status":
        return this.taxStatus(input, actor);
      case "find_party":
        return this.findParty(input, actor);
      case "payroll_status":
        return this.payrollStatus(input);
      default:
        return { ok: false, text: `No tool called ${name}.` };
    }
  }

  /* ---------------------------------------------------------------------- */

  private async findTransactions(input: Record<string, unknown>) {
    const where = [LIVE];
    const from = text(input.from);
    const to = text(input.to);
    const search = text(input.search);
    const category = text(input.category);
    const direction = text(input.direction);

    if (from) where.push(gte(transactions.txnDate, from));
    if (to) where.push(lte(transactions.txnDate, to));
    if (direction === "in" || direction === "out") {
      where.push(eq(transactions.direction, direction));
    }
    if (search) {
      const term = `%${search}%`;
      where.push(
        or(
          ilike(transactions.description, term),
          ilike(transactions.reference, term),
          ilike(vendors.name, term),
        )!,
      );
    }
    if (category) where.push(ilike(categories.name, `%${category}%`));

    const rows = await this.db.client
      .select({
        refNo: transactions.refNo,
        txnDate: transactions.txnDate,
        direction: transactions.direction,
        amount: transactions.amount,
        description: transactions.description,
        vendorName: vendors.name,
        categoryName: categories.name,
        accountName: accounts.name,
      })
      .from(transactions)
      .leftJoin(vendors, eq(transactions.vendorId, vendors.id))
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .leftJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(and(...where))
      .orderBy(desc(transactions.txnDate), desc(transactions.createdAt))
      .limit(100);

    if (!rows.length) return { ok: true, text: "No entries match that." };

    const total = rows.reduce(
      (sum, r) => sum + (r.direction === "out" ? -1 : 1) * Number(r.amount),
      0,
    );

    const lines = rows.map(
      (r) =>
        `${r.txnDate} · ${r.refNo} · ${r.direction === "in" ? "IN " : "OUT"} ${formatMoney(r.amount)} · ${r.description}${r.vendorName ? ` · ${r.vendorName}` : ""}${r.categoryName ? ` · ${r.categoryName}` : ""}`,
    );

    return {
      ok: true,
      text: `${rows.length} entr${rows.length === 1 ? "y" : "ies"} (net ${formatMoney(total.toFixed(2))}):\n${lines.join("\n")}`,
    };
  }

  private async accountBalances() {
    // A join and a group-by rather than a correlated subquery: inside a
    // subquery Drizzle renders the columns unqualified, so
    // `where account_id = id` compared two columns of the SAME table, was
    // never true, and every balance came back as its opening figure.
    const rows = await this.db.client
      .select({
        name: accounts.name,
        currency: accounts.currency,
        opening: accounts.openingBalance,
        moved: sql<string>`coalesce(sum(${transactions.signedAmount}) filter (where ${transactions.voidedAt} is null), 0)::text`,
      })
      .from(accounts)
      .leftJoin(transactions, eq(transactions.accountId, accounts.id))
      .where(and(eq(accounts.isActive, true), isNull(accounts.deletedAt)))
      .groupBy(
        accounts.id,
        accounts.name,
        accounts.currency,
        accounts.openingBalance,
      )
      .orderBy(accounts.sortOrder);

    if (!rows.length)
      return { ok: true, text: "No accounts have been set up." };

    const lines = rows.map((r) => {
      const balance = (Number(r.opening) + Number(r.moved)).toFixed(2);
      return `${r.name}: ${formatMoney(balance, { currency: r.currency })}`;
    });

    return { ok: true, text: lines.join("\n") };
  }

  private async periodSummary(input: Record<string, unknown>) {
    const from = text(input.from);
    const to = text(input.to);
    if (!from || !to) {
      return { ok: false, text: "A start and end date are both needed." };
    }

    const [totals] = await this.db.client
      .select({
        moneyIn: sql<string>`coalesce(sum(case when ${transactions.direction} = 'in' then ${transactions.amount} else 0 end), 0)::text`,
        moneyOut: sql<string>`coalesce(sum(case when ${transactions.direction} = 'out' then ${transactions.amount} else 0 end), 0)::text`,
        entries: sql<number>`count(*)::int`,
      })
      .from(transactions)
      // Spoken aloud to the owner, so a wrong figure here is not a wrong pixel
      // — it is an answer. Own-account transfers were counted on both sides:
      // the assistant said 1,76,600 spent in August while every report said
      // 1,11,600.
      .where(
        and(
          gte(transactions.txnDate, from),
          lte(transactions.txnDate, to),
          notATransfer(),
          LIVE,
        ),
      );

    const spend = await this.db.client
      .select({
        name: sql<string>`coalesce(parent.name, ${categories.name}, 'Uncategorised')`,
        total: sql<string>`sum(${transactions.amount})::text`,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .leftJoin(
        sql`${categories} as parent`,
        sql`parent.id = ${categories.parentId}`,
      )
      .where(
        and(
          gte(transactions.txnDate, from),
          lte(transactions.txnDate, to),
          eq(transactions.direction, "out"),
          notATransfer(),
          LIVE,
        ),
      )
      .groupBy(sql`1`)
      .orderBy(sql`2 desc`)
      .limit(24);

    const net = Number(totals.moneyIn) - Number(totals.moneyOut);

    return {
      ok: true,
      text: [
        `${from} to ${to}, ${totals.entries} entries`,
        `In  ${formatMoney(totals.moneyIn)}`,
        `Out ${formatMoney(totals.moneyOut)}`,
        `Net ${formatMoney(net.toFixed(2))}`,
        spend.length ? "Biggest headings:" : "",
        ...spend.map((s) => `  ${s.name}: ${formatMoney(s.total)}`),
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  private async taxStatus(
    input: Record<string, unknown>,
    actor: AuthenticatedUser,
  ) {
    const year = Number(input.year) || Number(todayInDhaka().slice(0, 4));
    const lines: string[] = [];

    for (let month = 1; month <= 12; month++) {
      const start = `${year}-${String(month).padStart(2, "0")}-01`;
      const end = `${year}-${String(month).padStart(2, "0")}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;

      const [salary] = await this.db.client
        .select({
          total: sql<string>`coalesce(sum(${payrollLines.tdsAmount}), 0)::text`,
        })
        .from(payrollLines)
        .innerJoin(payrollRuns, eq(payrollLines.payrollRunId, payrollRuns.id))
        .where(
          and(
            eq(payrollRuns.periodYear, year),
            eq(payrollRuns.periodMonth, month),
            sql`${payrollRuns.status} <> 'draft'`,
          ),
        );

      const [vendor] = await this.db.client
        .select({
          total: sql<string>`coalesce(sum(${transactions.withheldTaxAmount}), 0)::text`,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.direction, "out"),
            gte(transactions.txnDate, start),
            lte(transactions.txnDate, end),
            LIVE,
          ),
        );

      const [deposited] = await this.db.client
        .select({
          total: sql<string>`coalesce(sum(${tdsDeposits.amount}), 0)::text`,
        })
        .from(tdsDeposits)
        .where(
          and(
            eq(tdsDeposits.periodYear, year),
            eq(tdsDeposits.periodMonth, month),
            // The assistant answers questions about tax owed, so it reads the
            // same rule the screens do rather than its own.
            CHALLAN_COUNTS,
          ),
        );

      const deducted = Number(salary.total) + Number(vendor.total);
      const paid = Number(deposited.total);
      if (deducted === 0 && paid === 0) continue;

      const held = Math.max(0, deducted - paid);
      lines.push(
        `${start.slice(0, 7)}: deducted ${formatMoney(deducted.toFixed(2))}, deposited ${formatMoney(paid.toFixed(2))}${held > 0 ? `, STILL HELD ${formatMoney(held.toFixed(2))}` : ", settled"}`,
      );
    }

    if (hasPermission(actor.role, "incometax.read")) {
      const records = await this.db.client
        .select({
          label: incomeTaxRecords.recordType,
          quarter: incomeTaxRecords.quarter,
          due: incomeTaxRecords.dueDate,
          payable: incomeTaxRecords.amountPayable,
          paid: incomeTaxRecords.amountPaid,
          status: incomeTaxRecords.status,
        })
        .from(incomeTaxRecords)
        .orderBy(incomeTaxRecords.dueDate)
        .limit(24);

      if (records.length) {
        lines.push("", "Company income tax:");
        for (const r of records) {
          lines.push(
            `  ${r.label === "advance_quarter" ? `Advance ${r.quarter}` : "Annual return"} due ${r.due}: assessed ${formatMoney(r.payable)}, paid ${formatMoney(r.paid)} (${r.status})`,
          );
        }
      }
    }

    return {
      ok: true,
      text: lines.length
        ? lines.join("\n")
        : `Nothing was withheld or deposited in ${year}.`,
    };
  }

  private async findParty(
    input: Record<string, unknown>,
    actor: AuthenticatedUser,
  ) {
    const name = text(input.name);
    if (!name) return { ok: false, text: "A name is needed." };
    const kind = text(input.kind);
    const term = `%${name}%`;
    const found: string[] = [];

    if (kind !== "person" && hasPermission(actor.role, "vendors.read")) {
      const rows = await this.db.client
        .select({
          name: vendors.name,
          type: vendors.type,
          etin: vendors.etin,
        })
        .from(vendors)
        .where(and(ilike(vendors.name, term), isNull(vendors.deletedAt)))
        .limit(25);
      for (const r of rows) {
        found.push(
          `Vendor: ${r.name} (${r.type})${r.etin ? `, e-TIN ${r.etin}` : ""}`,
        );
      }
    }

    if (kind !== "vendor" && hasPermission(actor.role, "team.read")) {
      // Deliberately no join to compensation_history. There is no code path
      // from this tool to a salary figure, whatever the model asks for.
      const rows = await this.db.client
        .select({
          name: teamMembers.fullName,
          designation: teamMembers.designation,
          department: teamMembers.department,
          engagement: teamMembers.engagementType,
          joined: teamMembers.joinedOn,
          status: teamMembers.status,
        })
        .from(teamMembers)
        .where(
          and(ilike(teamMembers.fullName, term), isNull(teamMembers.deletedAt)),
        )
        .limit(25);
      for (const r of rows) {
        found.push(
          `Person: ${r.name} — ${r.designation ?? "no designation"}${r.department ? `, ${r.department}` : ""}, ${r.engagement}, joined ${r.joined}, ${r.status}`,
        );
      }
    }

    return {
      ok: true,
      text: found.length
        ? found.join("\n")
        : `Nobody and nothing on file matches "${name}".`,
    };
  }

  private async payrollStatus(input: Record<string, unknown>) {
    const year = Number(input.year) || Number(todayInDhaka().slice(0, 4));

    const rows = await this.db.client
      .select({
        label: payrollRuns.label,
        status: payrollRuns.status,
        gross: payrollRuns.totalGross,
        tds: payrollRuns.totalTds,
        net: payrollRuns.totalNet,
        paidOn: payrollRuns.paymentDate,
      })
      .from(payrollRuns)
      .where(eq(payrollRuns.periodYear, year))
      .orderBy(payrollRuns.periodMonth);

    if (!rows.length) {
      return { ok: true, text: `No payroll runs exist for ${year}.` };
    }

    return {
      ok: true,
      text: rows
        .map(
          (r) =>
            `${r.label}: ${r.status}, gross ${formatMoney(r.gross)}, tax ${formatMoney(r.tds)}, net ${formatMoney(r.net)}${r.paidOn ? `, paid ${r.paidOn}` : ""}`,
        )
        .join("\n"),
    };
  }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

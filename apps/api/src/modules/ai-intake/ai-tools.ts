import type Anthropic from "@anthropic-ai/sdk";
import { Injectable } from "@nestjs/common";
import {
  formatMoney,
  hasPermission,
  todayInDhaka,
  type Permission,
} from "@finance/shared";
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import { stateOf } from "../hr-requests/hr-requests.schemas";
import { requestRowsSql } from "../hr-requests/request-rows";
import { CHALLAN_COUNTS } from "../tds/challan-counts";
import { notATransfer } from "../transactions/own-money";
import {
  accounts,
  bankAdviceLines,
  bankAdvices,
  categories,
  hrBudgetSpends,
  incomeTaxRecords,
  invoices,
  payrollLines,
  payrollRuns,
  subscriptionUsers,
  subscriptions,
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
  /*
   * The rest of the map (2 Oct 2026): a look-up for every part that keeps
   * records and had none. Each is gated on what its own screen asks for.
   */
  /*
   * Counting and listing, where `find_party` only finds a name. The owner
   * asked the live Assistant "amader total team member kotojon?" and was told
   * it had no tool to count with (2 Oct 2026).
   */
  {
    name: "team_members",
    description:
      "Count and list the people on the team, as the Team screen has them: how many in all, how many current (working or on leave) and past (resigned or let go), employees and contractors, and by department — then the people themselves, with role, department and joining date. Never pay. Use for 'how many people', 'who is in marketing', 'who joined this year', 'who left'.",
    requires: ["team.read"],
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: [
            "current",
            "past",
            "active",
            "on_leave",
            "resigned",
            "terminated",
          ],
          description:
            "current = working or on leave; past = resigned or let go. Leave out for everyone.",
        },
        engagement: { type: "string", enum: ["employee", "contractor"] },
        department: {
          type: "string",
          description: "Part of a department's name",
        },
        search: {
          type: "string",
          description: "Part of a name or a designation",
        },
        joinedFrom: {
          type: "string",
          description: "Joined on or after, YYYY-MM-DD",
        },
        joinedTo: {
          type: "string",
          description: "Joined on or before, YYYY-MM-DD",
        },
      },
    },
  },
  {
    name: "list_vendors",
    description:
      "Count and list the vendors on file: name, kind, e-TIN, BIN and whether their tax return was submitted (PSR). Use for 'how many vendors', 'which suppliers have no e-TIN'. Tools and subscriptions are not here: they are plans, under find_subscriptions.",
    requires: ["vendors.read"],
    input_schema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Part of a vendor's name" },
        type: {
          type: "string",
          enum: [
            "supplier",
            "contractor",
            "landlord",
            "utility",
            "government",
            "other",
            "ai_tool",
            "subscription",
            "hosting",
          ],
        },
        missing: {
          type: "string",
          enum: ["etin", "bin", "psr"],
          description: "Only those with no e-TIN, no BIN, or no PSR submitted",
        },
      },
    },
  },
  {
    name: "find_subscriptions",
    description:
      "The plans under AI tools and subscriptions: the tool, its plan, the price in dollars, how often it renews, when it next renews, the card it is paid from, who it is for and who is on it — and the payments recorded against each. Use for anything about a subscription, a tool, a renewal, or what a plan has cost.",
    requires: ["vendors.read"],
    input_schema: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description: "Part of the tool's name or the plan's name",
        },
        status: {
          type: "string",
          enum: ["active", "paused", "canceled", "expired"],
        },
        from: {
          type: "string",
          description: "Payments on or after this date, YYYY-MM-DD",
        },
        to: {
          type: "string",
          description: "Payments on or before this date, YYYY-MM-DD",
        },
      },
    },
  },
  {
    name: "find_invoices",
    description:
      "The invoices the company has sent, from the Invoice Builder: number, client, status, dates and total. An invoice is a document, not money received.",
    // What the Invoice Builder's own screens ask for.
    requires: ["transactions.write"],
    input_schema: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description: "Part of the number, the client or the project title",
        },
        status: { type: "string", description: "e.g. DRAFT, SENT, PAID" },
      },
    },
  },
  {
    name: "hr_requests",
    description:
      "What the HR portal has asked finance for, and where each request stands: pay changes, one-off amounts for a salary sheet, budgets and spends. Never returns a pay figure.",
    requires: ["hrrequests.read"],
    input_schema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["pay_change", "one_off", "budget", "spend"],
        },
        state: {
          type: "string",
          enum: ["pending", "held", "approved", "rejected", "withdrawn"],
          description: "Leave out for the ones still waiting: pending and held",
        },
      },
    },
  },
  {
    name: "hr_budget",
    description:
      "HR's budgets and the spending against each: the heading, the period, the amount asked for, what was spent and what has been paid.",
    requires: ["hrbudget.read"],
    input_schema: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description: "Part of the budget's heading or a spend's purpose",
        },
      },
    },
  },
  {
    name: "bank_advices",
    description:
      "The payment files built for the bank: each advice's title, value date, the account it is paid from, how many payments it holds, its total, and whether it has been downloaded. Never one person's amount.",
    requires: ["payroll.read"],
    input_schema: { type: "object", properties: {} },
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
      case "team_members":
        return this.teamMembers(input);
      case "list_vendors":
        return this.listVendors(input);
      case "find_subscriptions":
        return this.findSubscriptions(input, actor);
      case "find_invoices":
        return this.findInvoices(input);
      case "hr_requests":
        return this.hrRequests(input);
      case "hr_budget":
        return this.hrBudget(input);
      case "bank_advices":
        return this.bankAdvices();
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
      // Not a sheet in the trash: Payroll does not list one, and an answer
      // that does names a month's pay nobody ran.
      .where(
        and(eq(payrollRuns.periodYear, year), isNull(payrollRuns.deletedAt)),
      )
      .orderBy(payrollRuns.periodMonth);

    if (!rows.length) {
      return { ok: true, text: `No payroll runs exist for ${year}.` };
    }

    const by = (status: string) => rows.filter((r) => r.status === status);
    return {
      ok: true,
      text: [
        `${rows.length} payroll run${rows.length === 1 ? "" : "s"} in ${year}: ${by("paid").length} paid, ${by("partially_paid").length} partly paid, ${by("finalized").length} finalised, ${by("draft").length} draft.`,
        ...rows.map(
          (r) =>
            `${r.label}: ${r.status}, gross ${formatMoney(r.gross)}, tax ${formatMoney(r.tds)}, net ${formatMoney(r.net)}${r.paidOn ? `, paid ${r.paidOn}` : ""}`,
        ),
      ].join("\n"),
    };
  }

  /**
   * The team, counted the way the Team screen counts it and then listed.
   *
   * The screen's own total is everybody not deleted, whatever their status;
   * its two tabs split them into current (working or on leave) and past. The
   * counts are made in SQL over the whole team, never over the rows listed,
   * so a list cut at a hundred does not cut the count with it. No pay: there
   * is no join here to any salary, at any setting.
   */
  private async teamMembers(input: Record<string, unknown>) {
    const status = text(input.status);
    const engagement = text(input.engagement);
    const department = text(input.department);
    const search = text(input.search);
    const day = (value: unknown) => {
      const said = text(value);
      return said && /^\d{4}-\d{2}-\d{2}$/.test(said) ? said : undefined;
    };
    const joinedFrom = day(input.joinedFrom);
    const joinedTo = day(input.joinedTo);

    const everyone = isNull(teamMembers.deletedAt);
    const STATUS: Record<
      string,
      Array<"active" | "on_leave" | "resigned" | "terminated">
    > = {
      current: ["active", "on_leave"],
      past: ["resigned", "terminated"],
      active: ["active"],
      on_leave: ["on_leave"],
      resigned: ["resigned"],
      terminated: ["terminated"],
    };

    // The whole team, before any filter: what the Team screen's pager says.
    const [whole] = await this.db.client
      .select({
        all: sql<number>`count(*)::int`,
        current: sql<number>`count(*) filter (where ${teamMembers.status} in ('active', 'on_leave'))::int`,
        employees: sql<number>`count(*) filter (where ${teamMembers.status} in ('active', 'on_leave') and ${teamMembers.engagementType} = 'employee')::int`,
        contractors: sql<number>`count(*) filter (where ${teamMembers.status} in ('active', 'on_leave') and ${teamMembers.engagementType} = 'contractor')::int`,
        onLeave: sql<number>`count(*) filter (where ${teamMembers.status} = 'on_leave')::int`,
      })
      .from(teamMembers)
      .where(everyone);

    const where = [everyone];
    if (status && STATUS[status]) {
      where.push(inArray(teamMembers.status, STATUS[status]));
    }
    if (engagement === "employee" || engagement === "contractor") {
      where.push(eq(teamMembers.engagementType, engagement));
    }
    if (department)
      where.push(ilike(teamMembers.department, `%${department}%`));
    if (search) {
      const term = `%${search}%`;
      where.push(
        or(
          ilike(teamMembers.fullName, term),
          ilike(teamMembers.designation, term),
        )!,
      );
    }
    if (joinedFrom) where.push(gte(teamMembers.joinedOn, joinedFrom));
    if (joinedTo) where.push(lte(teamMembers.joinedOn, joinedTo));

    const [matched] = await this.db.client
      .select({ n: sql<number>`count(*)::int` })
      .from(teamMembers)
      .where(and(...where));

    const departments = await this.db.client
      .select({
        department: sql<string>`coalesce(nullif(trim(${teamMembers.department}), ''), 'No department')`,
        n: sql<number>`count(*)::int`,
      })
      .from(teamMembers)
      .where(and(...where))
      .groupBy(sql`1`)
      .orderBy(sql`2 desc`, sql`1`)
      .limit(20);

    const people = await this.db.client
      .select({
        name: teamMembers.fullName,
        designation: teamMembers.designation,
        department: teamMembers.department,
        engagement: teamMembers.engagementType,
        status: teamMembers.status,
        joined: teamMembers.joinedOn,
        ended: teamMembers.endedOn,
      })
      .from(teamMembers)
      .where(and(...where))
      .orderBy(teamMembers.joinedOn, teamMembers.fullName)
      .limit(100);

    const filtered =
      status || engagement || department || search || joinedFrom || joinedTo;
    return {
      ok: true,
      text: [
        `The Team screen lists ${whole.all} ${whole.all === 1 ? "person" : "people"} in all: ${whole.current} current (working or on leave; ${whole.onLeave} on leave) — ${whole.employees} employee${whole.employees === 1 ? "" : "s"} and ${whole.contractors} contractor${whole.contractors === 1 ? "" : "s"} — and ${whole.all - whole.current} past (resigned or let go).`,
        filtered ? `${matched.n} match what was asked.` : "",
        departments.length
          ? `By department: ${departments.map((d) => `${d.department} ${d.n}`).join(", ")}.`
          : "",
        ...people.map(
          (p) =>
            `${p.name} — ${p.designation ?? "no designation"}${p.department ? `, ${p.department}` : ""}, ${p.engagement}, joined ${p.joined}, ${p.status.replace("_", " ")}${p.ended ? `, left ${p.ended}` : ""}`,
        ),
        matched.n > people.length
          ? `(the first ${people.length} of ${matched.n} are listed)`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  /** The vendors, counted and listed: the supplier register's tax details. */
  private async listVendors(input: Record<string, unknown>) {
    const search = text(input.search);
    const type = text(input.type);
    const missing = text(input.missing);

    const where = [isNull(vendors.deletedAt)];
    if (search) where.push(ilike(vendors.name, `%${search}%`));
    if (
      type &&
      [
        "supplier",
        "contractor",
        "landlord",
        "utility",
        "government",
        "other",
        "ai_tool",
        "subscription",
        "hosting",
      ].includes(type)
    ) {
      where.push(sql`${vendors.type} = ${type}`);
    }
    if (missing === "etin")
      where.push(sql`coalesce(trim(${vendors.etin}), '') = ''`);
    if (missing === "bin")
      where.push(sql`coalesce(trim(${vendors.bin}), '') = ''`);
    if (missing === "psr") where.push(sql`${vendors.psrStatus} <> 'submitted'`);

    const [counted] = await this.db.client
      .select({
        n: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${vendors.isActive})::int`,
      })
      .from(vendors)
      .where(and(...where));

    const rows = await this.db.client
      .select({
        name: vendors.name,
        type: vendors.type,
        etin: vendors.etin,
        bin: vendors.bin,
        psr: vendors.psrStatus,
        active: vendors.isActive,
      })
      .from(vendors)
      .where(and(...where))
      .orderBy(vendors.name)
      .limit(100);

    if (!counted.n) {
      return { ok: true, text: "No vendor on file matches that." };
    }

    return {
      ok: true,
      text: [
        `${counted.n} vendor${counted.n === 1 ? "" : "s"} on file${search || type || missing ? " match" : ""} (${counted.active} active). No screen lists vendors today.`,
        ...rows.map(
          (v) =>
            `${v.name} (${v.type.replace("_", " ")})${v.etin ? `, e-TIN ${v.etin}` : ", no e-TIN"}${v.bin ? `, BIN ${v.bin}` : ""}, PSR ${v.psr.replace("_", " ")}${v.active ? "" : ", inactive"}`,
        ),
        counted.n > rows.length
          ? `(the first ${rows.length} of ${counted.n} are listed)`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  /**
   * The plans, and what was paid against each.
   *
   * The payments are the ledger's rows that carry the plan's id — the same
   * fact the AI tools card on Expense overview counts by — so a subscription
   * somebody filed as a plain payment is, correctly, not among them. They
   * are shown only to somebody who may read the ledger; the plans themselves
   * need `vendors.read`, which is what the register's own screen asks for.
   */
  private async findSubscriptions(
    input: Record<string, unknown>,
    actor: AuthenticatedUser,
  ) {
    const search = text(input.search);
    const status = text(input.status);
    // A date, or nothing: anything else reaching Postgres as a date is a 500.
    const day = (value: unknown) => {
      const said = text(value);
      return said && /^\d{4}-\d{2}-\d{2}$/.test(said) ? said : undefined;
    };
    const from = day(input.from);
    const to = day(input.to);

    const where = [isNull(subscriptions.deletedAt)];
    if (search) {
      const term = `%${search}%`;
      where.push(
        or(
          ilike(subscriptions.toolName, term),
          ilike(subscriptions.planName, term),
          ilike(subscriptions.boughtFor, term),
        )!,
      );
    }
    if (
      status === "active" ||
      status === "paused" ||
      status === "canceled" ||
      status === "expired"
    ) {
      where.push(eq(subscriptions.status, status));
    }

    const plans = await this.db.client
      .select({
        id: subscriptions.id,
        toolName: subscriptions.toolName,
        planName: subscriptions.planName,
        category: subscriptions.category,
        status: subscriptions.status,
        costUsd: subscriptions.costUsd,
        chargeUsd: subscriptions.chargeUsd,
        usdRate: subscriptions.usdRate,
        billingCycle: subscriptions.billingCycle,
        startDate: subscriptions.startDate,
        nextRenewalOn: subscriptions.nextRenewalOn,
        boughtFor: subscriptions.boughtFor,
        accountName: accounts.name,
      })
      .from(subscriptions)
      .leftJoin(accounts, eq(subscriptions.accountId, accounts.id))
      .where(and(...where))
      .orderBy(subscriptions.toolName, subscriptions.planName)
      .limit(60);

    // Counted over what was asked, not over the sixty listed.
    const [counted] = await this.db.client
      .select({
        n: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${subscriptions.status} = 'active')::int`,
        paused: sql<number>`count(*) filter (where ${subscriptions.status} = 'paused')::int`,
        canceled: sql<number>`count(*) filter (where ${subscriptions.status} = 'canceled')::int`,
        expired: sql<number>`count(*) filter (where ${subscriptions.status} = 'expired')::int`,
      })
      .from(subscriptions)
      .where(and(...where));

    if (!plans.length) {
      return {
        ok: true,
        text: search
          ? `No plan under AI tools and subscriptions matches "${search}".`
          : "No plans are on file under AI tools and subscriptions.",
      };
    }

    const ids = plans.map((plan) => plan.id);

    const seats = await this.db.client
      .select({
        subscriptionId: subscriptionUsers.subscriptionId,
        fullName: teamMembers.fullName,
      })
      .from(subscriptionUsers)
      .innerJoin(
        teamMembers,
        eq(subscriptionUsers.teamMemberId, teamMembers.id),
      )
      .where(inArray(subscriptionUsers.subscriptionId, ids));

    const maySeeLedger = hasPermission(actor.role, "transactions.read");
    const paid = maySeeLedger
      ? await this.db.client
          .select({
            subscriptionId: transactions.subscriptionId,
            // Summed in SQL: these are money.
            total: sql<string>`sum(${transactions.amount})::text`,
            entries: sql<number>`count(*)::int`,
            lastOn: sql<string>`max(${transactions.txnDate})::text`,
          })
          .from(transactions)
          .where(
            and(
              inArray(transactions.subscriptionId, ids),
              LIVE,
              // The bank's fee on a renewal is its own row, under Bank
              // charges; it is not what the plan cost.
              isNull(transactions.chargeForId),
              from ? gte(transactions.txnDate, from) : undefined,
              to ? lte(transactions.txnDate, to) : undefined,
            ),
          )
          .groupBy(transactions.subscriptionId)
      : [];

    const range =
      from || to ? ` between ${from ?? "the start"} and ${to ?? "today"}` : "";

    const lines = plans.map((plan) => {
      const on = seats
        .filter((seat) => seat.subscriptionId === plan.id)
        .map((seat) => seat.fullName);
      const payments = paid.find((row) => row.subscriptionId === plan.id);
      return [
        `${plan.toolName} — ${plan.planName} (${plan.category.replace(/_/g, " ")}, ${plan.status})`,
        `  $${plan.costUsd}${plan.chargeUsd && Number(plan.chargeUsd) > 0 ? ` plus a $${plan.chargeUsd} charge` : ""}, ${plan.billingCycle}${plan.usdRate ? `, at a rate of ${Number(plan.usdRate)}` : ""}`,
        `  started ${plan.startDate}${plan.nextRenewalOn ? `, next renewal ${plan.nextRenewalOn}` : ""}${plan.accountName ? `, paid from ${plan.accountName}` : ", no card or account on it"}`,
        plan.boughtFor ? `  for ${plan.boughtFor}` : null,
        on.length ? `  on it: ${on.join(", ")}` : null,
        maySeeLedger
          ? payments
            ? `  paid${range}: ${formatMoney(payments.total)} in ${payments.entries} payment${payments.entries === 1 ? "" : "s"}, the last on ${payments.lastOn}`
            : `  paid${range}: nothing recorded against this plan`
          : null,
      ]
        .filter(Boolean)
        .join("\n");
    });

    return {
      ok: true,
      text: [
        `${counted.n} plan${counted.n === 1 ? "" : "s"}: ${counted.active} active, ${counted.paused} paused, ${counted.canceled} cancelled, ${counted.expired} expired.${counted.n > plans.length ? ` The first ${plans.length} are below.` : ""}`,
        ...lines,
        maySeeLedger
          ? "A payment counts here only if it was recorded against the plan (Renew, or adding the plan). One filed as a plain payment is not."
          : "This person's role cannot read the ledger, so no payments are shown.",
      ].join("\n"),
    };
  }

  private async findInvoices(input: Record<string, unknown>) {
    const search = text(input.search);
    const status = text(input.status)?.toUpperCase();

    const where = [isNull(invoices.deletedAt)];
    if (search) {
      const term = `%${search}%`;
      where.push(
        or(
          ilike(invoices.invoiceNumber, term),
          ilike(invoices.clientName, term),
          sql`${invoices.document} ->> 'projectTitle' ilike ${term}`,
        )!,
      );
    }
    if (status) where.push(eq(invoices.status, status));

    const rows = await this.db.client
      .select({
        number: invoices.invoiceNumber,
        status: invoices.status,
        client: invoices.clientName,
        project: sql<string | null>`${invoices.document} ->> 'projectTitle'`,
        issuedOn: invoices.issuedOn,
        dueOn: invoices.dueOn,
        total: invoices.totalAmount,
      })
      .from(invoices)
      .where(and(...where))
      .orderBy(
        sql`${invoices.issuedOn} desc nulls last`,
        desc(invoices.createdAt),
      )
      .limit(60);

    if (!rows.length)
      return { ok: true, text: "No saved invoice matches that." };

    return {
      ok: true,
      text: [
        `${rows.length} invoice${rows.length === 1 ? "" : "s"}. These are documents sent; whether one was paid is the status somebody set on it, not a ledger entry:`,
        ...rows.map(
          (r) =>
            `${r.number} · ${r.status} · ${r.client ?? "no client named"}${r.project ? ` · ${r.project}` : ""} · ${formatMoney(r.total)}${r.issuedOn ? ` · issued ${r.issuedOn}` : ""}${r.dueOn ? ` · due ${r.dueOn}` : ""}`,
        ),
      ].join("\n"),
    };
  }

  /**
   * The HR portal's requests, read off the one relation the page, the HR
   * portal's own status calls and the webhook all read (`requestRowsSql`).
   *
   * No pay figure. A pay change's amount is somebody's salary and a one-off
   * is their bonus, and pay has no tool at any setting; those two kinds say
   * who and where it stands, never how much. A budget and a spend are the
   * company's spending and carry their amount.
   */
  private async hrRequests(input: Record<string, unknown>) {
    const kind = text(input.kind);
    const state = text(input.state);

    const stored: Record<string, string[]> = {
      pending: ["received"],
      held: ["held"],
      approved: ["approved"],
      rejected: ["refused"],
      withdrawn: ["withdrawn"],
    };
    const statuses =
      state && stored[state] ? stored[state] : ["received", "held"];

    const result = await this.db.client.execute(sql`
      select r.kind, r.subject, r.detail, r.status, r.paid,
             r.effective_on::text as effective_on,
             (r.received_at at time zone 'Asia/Dhaka')::date::text as received_on,
             case when r.kind in ('budget', 'spend') then r.amount::text end as amount
        from (${requestRowsSql()}) r
       where r.status in (${sql.join(
         statuses.map((status) => sql`${status}`),
         sql`, `,
       )})
         ${kind ? sql`and r.kind = ${kind}` : sql``}
       order by r.received_at desc
       limit 80`);

    const rows = result.rows as unknown as Array<{
      kind: string;
      subject: string;
      detail: string | null;
      status: string;
      paid: boolean;
      effective_on: string | null;
      received_on: string | null;
      amount: string | null;
    }>;

    const asked = state && stored[state] ? state : "waiting (pending or held)";
    if (!rows.length) {
      return {
        ok: true,
        text: `No HR request${kind ? ` of kind ${kind.replace("_", " ")}` : ""} is ${asked}.`,
      };
    }

    const NAMES: Record<string, string> = {
      pay_change: "Pay change",
      one_off: "One-off for a salary sheet",
      budget: "Budget",
      spend: "Spend",
    };

    // Each kind counted, as the page's own filters would: the eighty listed
    // are the newest, the count is all of them.
    const counted = await this.db.client.execute(sql`
      select r.kind, count(*)::int as n
        from (${requestRowsSql()}) r
       where r.status in (${sql.join(
         statuses.map((one) => sql`${one}`),
         sql`, `,
       )})
         ${kind ? sql`and r.kind = ${kind}` : sql``}
       group by r.kind`);
    const byKind = counted.rows as unknown as Array<{
      kind: string;
      n: number;
    }>;
    const total = byKind.reduce((sum, one) => sum + Number(one.n), 0);

    return {
      ok: true,
      text: [
        `${total} HR request${total === 1 ? "" : "s"}, ${asked}: ${byKind
          .map(
            (one) => `${one.n} ${(NAMES[one.kind] ?? one.kind).toLowerCase()}`,
          )
          .join(
            ", ",
          )}. Pay figures are never shown here.${total > rows.length ? ` The newest ${rows.length} are below.` : ""}`,
        ...rows.map(
          (r) =>
            // HR's own words on a pay change or a one-off are left out with
            // its figure: "increment 30,000 to 35,000" is a reason, and it is
            // the pay.
            `${NAMES[r.kind] ?? r.kind} · ${r.subject}${r.amount ? ` · ${formatMoney(r.amount)}` : ""}${r.detail && (r.kind === "budget" || r.kind === "spend") ? ` · ${r.detail}` : ""}${r.effective_on ? ` · for ${r.effective_on}` : ""} · ${r.paid ? "approved and paid" : stateOf(r.status)}${r.received_on ? ` · received ${r.received_on}` : ""}`,
        ),
      ].join("\n"),
    };
  }

  private async hrBudget(input: Record<string, unknown>) {
    const search = text(input.search);
    const term = search ? `%${search}%` : null;

    // One row a budget, with its spends counted and summed in SQL.
    const result = await this.db.client.execute(sql`
      select p.category_name, p.starts_on::text as starts_on,
             p.ends_on::text as ends_on, p.amount::text as amount, p.status,
             count(s.id)::int as spends,
             coalesce(sum(s.amount) filter (where s.status in ('approved', 'paid')), 0)::text as approved,
             coalesce(sum(s.amount) filter (where s.status = 'paid'), 0)::text as paid,
             coalesce(sum(s.amount) filter (where s.status in ('received', 'held')), 0)::text as waiting
        from hr_budget_periods p
        left join hr_budget_spends s on s.budget_external_id = p.external_id
       where ${term ? sql`p.category_name ilike ${term}` : sql`true`}
       group by p.id
       order by p.starts_on desc
       limit 40`);
    const budgets = result.rows as unknown as Array<{
      category_name: string;
      starts_on: string;
      ends_on: string;
      amount: string;
      status: string;
      spends: number;
      approved: string;
      paid: string;
      waiting: string;
    }>;

    const spends = await this.db.client
      .select({
        spentOn: hrBudgetSpends.spentOn,
        amount: hrBudgetSpends.amount,
        purpose: hrBudgetSpends.purpose,
        status: hrBudgetSpends.status,
      })
      .from(hrBudgetSpends)
      .where(term ? ilike(hrBudgetSpends.purpose, term) : undefined)
      .orderBy(desc(hrBudgetSpends.spentOn))
      .limit(25);

    if (!budgets.length && !spends.length) {
      return {
        ok: true,
        text: search
          ? `No HR budget or spend matches "${search}".`
          : "The HR portal has sent no budget and no spend.",
      };
    }

    return {
      ok: true,
      text: [
        budgets.length ? "Budgets:" : "",
        ...budgets.map(
          (b) =>
            `  ${b.category_name}, ${b.starts_on} to ${b.ends_on}: asked ${formatMoney(b.amount)} (${stateOf(b.status)}); ${b.spends} spend${b.spends === 1 ? "" : "s"} against it — approved ${formatMoney(b.approved)}, of which paid ${formatMoney(b.paid)}; still waiting ${formatMoney(b.waiting)}`,
        ),
        spends.length ? "The latest spends:" : "",
        ...spends.map(
          (s) =>
            `  ${s.spentOn} · ${formatMoney(s.amount)} · ${s.purpose} · ${s.status === "paid" ? "approved and paid" : stateOf(s.status)}`,
        ),
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  /**
   * The advices, never their lines: a line is one person's net pay, and pay
   * has no tool. The total is the file's, summed in SQL.
   */
  private async bankAdvices() {
    const rows = await this.db.client
      .select({
        title: bankAdvices.title,
        valueDate: bankAdvices.valueDate,
        accountName: accounts.name,
        downloadedAt: bankAdvices.downloadedAt,
        lines: sql<number>`count(${bankAdviceLines.id})::int`,
        total: sql<string>`coalesce(sum(${bankAdviceLines.amount}), 0)::text`,
      })
      .from(bankAdvices)
      .leftJoin(accounts, eq(bankAdvices.accountId, accounts.id))
      .leftJoin(
        bankAdviceLines,
        eq(bankAdviceLines.bankAdviceId, bankAdvices.id),
      )
      .where(isNull(bankAdvices.deletedAt))
      .groupBy(bankAdvices.id, accounts.name)
      .orderBy(desc(bankAdvices.valueDate), desc(bankAdvices.createdAt))
      .limit(36);

    if (!rows.length) {
      return { ok: true, text: "No bank advice has been built yet." };
    }

    return {
      ok: true,
      text: rows
        .map(
          (r) =>
            // A file of one payment's total is that one person's pay, so it
            // is given only for two or more.
            `${r.title}: value date ${r.valueDate}, ${r.lines} payment${r.lines === 1 ? "" : "s"}${r.lines > 1 ? ` totalling ${formatMoney(r.total)}` : ""}${r.accountName ? `, from ${r.accountName}` : ""}, ${r.downloadedAt ? "downloaded for the bank" : "not downloaded yet"}`,
        )
        .join("\n"),
    };
  }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

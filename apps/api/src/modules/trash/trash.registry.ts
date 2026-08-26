import type { Permission } from "@finance/shared";

/**
 * Every kind of row that can be deleted, in one list.
 *
 * The alternative was a delete endpoint on each of fifteen controllers and a
 * trash screen that knew how to read fifteen shapes. That version drifts: the
 * sixteenth table gets its delete and not its trash entry, and the row
 * disappears with nowhere to be found. Here a table is either in this list —
 * deletable, restorable, listed, purgeable — or it is not deletable at all.
 *
 * `table` and every SQL fragment below are literals written in this file. None
 * of them is ever built from a request, which is what makes interpolating them
 * into SQL safe; the id is always a bound parameter.
 */

export type TrashKind =
  | "transaction"
  | "account"
  | "category"
  | "vendor"
  | "team-member"
  | "compensation"
  | "payroll-run"
  | "subscription"
  | "tds-deposit"
  | "withholding-return"
  | "income-tax"
  | "fx-rate"
  | "statement"
  | "import-batch"
  | "user";

export type TrashEntry = {
  kind: TrashKind;
  /** How the dialog names it: "Delete this transaction?" Lower case. */
  label: string;
  /** How the trash groups them: "Transactions". */
  plural: string;
  table: string;
  permission: Permission;
  module: string;

  /** SQL for the headline the trash shows. Never null — coalesce it. */
  title: string;
  /** SQL for the second line: an amount, a period, a status. May be null. */
  detail: string;
  /** SQL for the row's own date, so the trash can say when it was from. */
  occurredAt: string;

  /**
   * Money rows are voided as well as deleted.
   *
   * Not belt and braces — it is what makes the totals right. Every sum in this
   * application already excludes voided rows, in twenty-nine places across nine
   * services. Setting `voided_at` means a deleted row leaves all of them at
   * once, without any of those queries being touched. Filtering `deleted_at`
   * out of the *lists* is then the only remaining work, and a list that is
   * missed shows a row that should be gone — visible, and reported in a day —
   * rather than a total that is quietly wrong.
   */
  alsoVoids?: boolean;

  /**
   * When the row must not go, and what to say instead.
   *
   * `sql` is a boolean expression over the row being deleted, aliased `r`. It
   * runs before anything is written; true means refuse.
   */
  blockedWhen?: { sql: string; message: string };
};

/** Not deletable, and each for its own reason. See deploy/sql/2026-08-26-trash.sql. */
const REGISTRY: TrashEntry[] = [
  {
    kind: "transaction",
    label: "transaction",
    plural: "Transactions",
    table: "transactions",
    permission: "transactions.write",
    module: "transactions",
    title: "coalesce(r.description, r.ref_no, 'Transaction')",
    detail:
      "r.ref_no || ' · ' || (case when r.direction = 'in' then '+' else '-' end) || r.amount",
    occurredAt: "r.txn_date::text",
    alsoVoids: true,
  },
  {
    kind: "account",
    label: "account",
    plural: "Accounts",
    table: "accounts",
    permission: "accounts.write",
    module: "accounts",
    title: "r.name",
    detail: "coalesce(r.bank_name || ' · ', '') || r.type",
    occurredAt: "r.created_at::date::text",
    blockedWhen: {
      sql: "exists (select 1 from transactions t where t.account_id = r.id and t.deleted_at is null)",
      message:
        "This account still has entries against it. Delete or move those first — deleting the account would leave them pointing at nothing.",
    },
  },
  {
    kind: "category",
    label: "category",
    plural: "Categories",
    table: "categories",
    permission: "categories.write",
    module: "categories",
    title: "r.name",
    detail: "r.kind::text",
    occurredAt: "r.created_at::date::text",
    blockedWhen: {
      sql: "exists (select 1 from transactions t where t.category_id = r.id and t.deleted_at is null)",
      message:
        "Entries are filed under this category. Move them to another one first, or archive the category instead of deleting it.",
    },
  },
  {
    kind: "vendor",
    label: "vendor",
    plural: "Vendors",
    table: "vendors",
    permission: "vendors.write",
    module: "vendors",
    title: "r.name",
    detail: "r.type::text",
    occurredAt: "r.created_at::date::text",
    blockedWhen: {
      sql: "exists (select 1 from transactions t where t.vendor_id = r.id and t.deleted_at is null)",
      message:
        "There are entries paid to this vendor. Deleting it would leave them without a payee.",
    },
  },
  {
    kind: "team-member",
    label: "team member",
    plural: "Team members",
    table: "team_members",
    permission: "team.write",
    module: "team",
    title: "r.full_name",
    detail: "coalesce(r.designation || ' · ', '') || r.status::text",
    occurredAt: "r.joined_on::text",
    blockedWhen: {
      sql: "exists (select 1 from transactions t where t.team_member_id = r.id and t.deleted_at is null)",
      message:
        "This person has payments recorded against them. Set them to ended instead — deleting would detach their salary history from the ledger.",
    },
  },
  {
    kind: "compensation",
    label: "salary record",
    plural: "Salary records",
    table: "compensation_history",
    permission: "team.compensation.write",
    module: "team",
    title:
      "(select m.full_name from team_members m where m.id = r.team_member_id)",
    detail: "r.gross_amount || ' from ' || r.effective_from::text",
    occurredAt: "r.effective_from::text",
  },
  {
    kind: "payroll-run",
    label: "payroll run",
    plural: "Payroll runs",
    table: "payroll_runs",
    permission: "payroll.write",
    module: "payroll",
    title: "coalesce(r.label, r.period_year || '-' || r.period_month)",
    detail: "r.status::text || ' · net ' || r.total_net",
    occurredAt: "make_date(r.period_year, r.period_month, 1)::text",
    blockedWhen: {
      sql: "r.status = 'paid'",
      message:
        "This run has been paid. The money left the account, so the run is a record of something that happened — void the payment entries instead.",
    },
  },
  {
    kind: "subscription",
    label: "subscription",
    plural: "Subscriptions",
    table: "subscriptions",
    permission: "vendors.write",
    module: "subscriptions",
    title: "coalesce(r.tool_name, r.plan_name)",
    detail: "r.status::text || ' · ' || coalesce(r.cost_bdt, '0')",
    occurredAt: "r.start_date::text",
  },
  {
    kind: "tds-deposit",
    label: "TDS deposit",
    plural: "TDS deposits",
    table: "tds_deposits",
    permission: "tds.write",
    module: "tds",
    title: "coalesce(r.challan_number, 'Challan')",
    detail: "r.amount || ' on ' || r.deposit_date::text",
    occurredAt: "r.deposit_date::text",
  },
  {
    kind: "withholding-return",
    label: "withholding return",
    plural: "Withholding returns",
    table: "withholding_returns",
    permission: "tds.write",
    module: "tds",
    title: "'Q' || r.quarter || ' ' || r.fiscal_year",
    detail: "r.status::text",
    occurredAt: "r.period_start::text",
  },
  {
    kind: "income-tax",
    label: "income tax record",
    plural: "Income tax records",
    table: "income_tax_records",
    permission: "incometax.write",
    module: "income-tax",
    title: "r.record_type::text || ' ' || r.assessment_year",
    detail: "r.status::text || ' · ' || r.amount_payable",
    occurredAt: "r.due_date::text",
  },
  {
    kind: "fx-rate",
    label: "rate",
    plural: "Exchange rates",
    table: "fx_rates",
    permission: "settings.write",
    module: "settings",
    // Trimmed to two places for reading. The stored rate keeps its six —
    // this is a label in a list, not a figure anything is computed from.
    title:
      "r.base_currency || '/' || r.quote_currency || ' ' || round(r.rate, 2)",
    detail: "r.source::text",
    occurredAt: "r.rate_date::text",
  },
  {
    kind: "statement",
    label: "statement",
    plural: "Statements",
    table: "statements",
    permission: "transactions.write",
    module: "reports",
    title: "r.cycle::text || ' ' || r.period_start::text",
    detail: "r.status::text",
    occurredAt: "r.period_start::text",
  },
  {
    kind: "import-batch",
    label: "import",
    plural: "Imports",
    table: "import_batches",
    permission: "imports.run",
    module: "imports",
    title: "r.filename",
    detail: "r.status::text || ' · ' || r.total_rows || ' rows'",
    occurredAt: "r.created_at::date::text",
    blockedWhen: {
      sql: "r.committed_at is not null and r.reverted_at is null",
      message:
        "This import is committed — its rows are in the ledger. Revert it first, then the batch can be deleted.",
    },
  },
  {
    kind: "user",
    label: "sign-in",
    plural: "Sign-ins",
    table: "users",
    permission: "users.manage",
    module: "users",
    title: "r.full_name",
    detail: "r.email || ' · ' || r.role::text",
    occurredAt: "r.created_at::date::text",
    blockedWhen: {
      /*
       * The one that locks everybody out.
       *
       * Deleting the last super admin leaves an application nobody can change
       * the settings of, add a user to, or recover — and the way back is a
       * hand-written UPDATE on the production database.
       */
      sql: "r.role = 'super_admin' and (select count(*) from users u where u.role = 'super_admin' and u.status = 'active' and u.deleted_at is null) <= 1",
      message:
        "This is the only super admin left. Promote somebody else first, or nobody will be able to change settings or add users.",
    },
  },
];

const BY_KIND = new Map(REGISTRY.map((e) => [e.kind, e]));

export function trashEntries(): TrashEntry[] {
  return REGISTRY;
}

export function trashEntry(kind: string): TrashEntry | undefined {
  return BY_KIND.get(kind as TrashKind);
}

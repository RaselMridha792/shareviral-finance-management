import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ACCOUNT_TYPE_LABELS,
  formatMoney,
  type CreateAccountInput,
  type ListAccountsQuery,
  type UpdateAccountInput,
} from "@finance/shared";
import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import { overdraftWatch } from "../../common/money/overdraft";
import {
  accounts,
  incomeTaxRecords,
  payrollRuns,
  tdsDeposits,
  transactions,
  type Account,
} from "../../db/schema";
import { SettingsService } from "../settings/settings.service";

/**
 * An account as the rest of the world may see it.
 *
 * The two sealed card columns are omitted at the TYPE level, not merely left
 * out of `projection`, and that is the guard rather than a tidy-up: this type
 * is what `list()` and `findOne()` promise, so adding either column to the
 * projection later becomes a compile error instead of a leak. It would
 * otherwise be an easy line to write — every other account column lives there
 * — and it would put a card number on the wire to every account picker, into
 * the Accounts spreadsheet, and into `audit_logs.before` for every mutation on
 * this table, all from one edit.
 *
 * `cardLast4` and `cardExpiry` stay: four digits and a month are what the
 * screen shows to tell one card from another.
 */
export type AccountDto = Omit<
  Account,
  | "deletedAt"
  | "deletedBy"
  | "deleteReason"
  | "entityId"
  | "cardNumberSealed"
  | "cardCvcSealed"
>;

/**
 * What is hanging off an account, counted before anyone is asked to confirm
 * anything.
 *
 * Four tables point at `accounts`, and a warning that says "this may have
 * related records" is not a warning - it is a shrug. This is what the dialog
 * shows instead: how many, worth how much, and over what span.
 */
export type AccountAttachments = {
  transactions: number;
  /** Live rows only. A voided entry is struck through, not gone. */
  liveTransactions: number;
  firstTxnDate: string | null;
  lastTxnDate: string | null;
  /** Signed, so it reads the same way the register does. */
  net: string;
  tdsDeposits: number;
  incomeTaxPayments: number;
  payrollRuns: number;
  /** Nothing at all points at it, so deleting is only tidying up. */
  deletable: boolean;
};

/**
 * An account as the Accounts screen needs it: what it holds *now*.
 *
 * `openingBalance` stays alongside rather than being replaced. It is a real
 * fact — the figure the books were opened at, and the base every later number
 * is computed from — and the screen shows it as the caption under the balance.
 */
export type AccountWithBalanceDto = AccountDto & {
  /** The ledger's figure, always taka. */
  balance: string;
  /**
   * The same balance in the account's own currency — dollars added up rather
   * than taka divided. Equal to `balance` for a BDT account.
   */
  ownBalance: string;
  /** False when some row had no dollars and no rate of its own. */
  ownBalanceExact: boolean;
};

/**
 * Where an account stands: what it opened at, plus everything that has moved
 * through it since, with voided rows excluded.
 *
 * Paired with `.leftJoin(transactions, eq(transactions.accountId, accounts.id))`
 * and `.groupBy(accounts.id)`, and it does not work without them.
 *
 * It was briefly written as a correlated subquery instead, and that was wrong
 * in a way worth recording. Inside a `sql` template drizzle renders a column as
 * its bare name — `"account_id"`, not `"transactions"."account_id"` — because
 * the template is text it does not parse. Its own operators qualify; the
 * template does not. So `where ${transactions.accountId} = ${accounts.id}`
 * became `where "account_id" = "id"`, both of which resolve inside the
 * subquery's own FROM, and the condition asked whether a transaction's account
 * is its own id. Never true, sum NULL, coalesce 0 — every balance came back
 * exactly equal to its opening figure, which is precisely the bug the change
 * was meant to fix and looks identical to it.
 *
 * The join is safe because the correlation is written with `eq()`, which
 * qualifies, and the three columns named below exist on one table each.
 */
const currentBalance = sql<string>`(
  ${accounts.openingBalance} + coalesce(
    sum(${transactions.signedAmount}) filter (
      where ${transactions.voidedAt} is null
    ), 0)
)::text`;

/**
 * The same balance, in the currency the account is actually kept in.
 *
 * The taka expression above is the ledger's own arithmetic and stays exactly
 * as it is. This one answers a different question, and the owner's rule is
 * that for a foreign account it is the question that matters: **the account's
 * figures are in the account's own currency.**
 *
 * It is a SUM OF THE DOLLARS, never a division of the taka. That distinction
 * is the whole bug: $14,000 recorded at 118.00 stores 16,52,000.00, and
 * dividing that by today's 122.50 reads back $13,485.71. The money never
 * moved; only the rate did. Every row already carries what it was in dollars —
 * `original_amount` with `original_currency` — and nothing was reading it.
 *
 * A BDT account takes the taka expression verbatim — its own currency IS the
 * ledger's, and dividing it by a rate nobody asked about is how the transfer's
 * stamped `usd_rate` turned a taka account's balance into dollars.
 *
 * Rows with no dollar figure fall back to their OWN recorded rate before
 * anything else, so a row that knows what it was worth is never re-valued at
 * today's price. A row with no rate of any kind contributes nothing here and
 * makes the answer approximate rather than wrong — `ownCurrencyExact` below is
 * what says so, and the screen marks it.
 */
const ownCurrencyBalance = sql<string>`(
  case when ${accounts.currency} = 'BDT' then (
    ${accounts.openingBalance} + coalesce(
      sum(${transactions.signedAmount}) filter (
        where ${transactions.voidedAt} is null
      ), 0)
  ) else (
  coalesce(${accounts.openingBalanceUsd}, 0) + coalesce(
    sum(
      case
        when ${transactions.originalCurrency} = 'USD'
             and ${transactions.originalAmount} is not null
        then case when ${transactions.direction} = 'in'
                  then ${transactions.originalAmount}
                  else -${transactions.originalAmount} end
        when coalesce(${transactions.fxRate}, ${transactions.usdRate}) > 0
        then ${transactions.signedAmount}
             / coalesce(${transactions.fxRate}, ${transactions.usdRate})
        else 0
      end
    ) filter (where ${transactions.voidedAt} is null), 0)
  ) end
)::numeric(14,2)::text`;

/**
 * Whether that figure is a record or an estimate.
 *
 * True only when the opening was stated in the account's own currency AND
 * every live row carried either its dollars or its own rate. One row without
 * either makes the total an estimate, and an estimate that looks recorded is
 * the failure this app is most careful about.
 */
const ownCurrencyExact = sql<boolean>`(
  ${accounts.currency} = 'BDT' or (
  ${accounts.openingBalanceUsd} is not null
  and coalesce(bool_and(
    /*
     * coalesce(..., false) around the whole test, and it is the difference
     * between this working and not.
     *
     * A row with no original, no fx_rate and no usd_rate makes both halves
     * UNKNOWN rather than false -- null = 'USD' is UNKNOWN, null > 0 is
     * UNKNOWN -- and false OR UNKNOWN is UNKNOWN. bool_and then SKIPS the
     * row, so the one row that should have made the answer approximate was
     * the one row silently ignored. The same three-valued trap the tooling
     * predicate documents.
     *
     * (No backticks in here: this comment lives inside a JS template
     * literal, and one of them ends the string.)
     */
    coalesce(
      (${transactions.originalCurrency} = 'USD'
        and ${transactions.originalAmount} is not null)
      or coalesce(${transactions.fxRate}, ${transactions.usdRate}) > 0,
      false
    )
  ) filter (where ${transactions.voidedAt} is null), true))
)`;

@Injectable()
export class AccountsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Carries the current balance, which it did not until 2026-08-16.
   *
   * The Accounts screen showed `openingBalance` under the heading "Opening
   * total" and on each card as the one large figure. Read literally that was
   * accurate; read the way anybody reads an Accounts page it was the balance,
   * and it never moved. The owner recorded two cash-ins of ৳1,00,000 into a
   * tin showing ৳40,000 and it still said ৳40,000 — twice — which is exactly
   * the right thing to report as a bug.
   *
   * `balances()` below had already been corrected for the same mistake and
   * this screen never called it. Putting the figure on the list the screen
   * does call is what stops the two from being able to disagree again.
   */
  async list(query: ListAccountsQuery): Promise<AccountWithBalanceDto[]> {
    const filters = [isNull(accounts.deletedAt)];
    if (!query.includeInactive) filters.push(eq(accounts.isActive, true));

    return (
      this.db.client
        .select({
          ...projection,
          balance: currentBalance,
          ownBalance: ownCurrencyBalance,
          ownBalanceExact: ownCurrencyExact,
        })
        .from(accounts)
        .leftJoin(transactions, eq(transactions.accountId, accounts.id))
        .where(and(...filters))
        // The primary key alone. Postgres allows every other column of the same
        // table once its key is grouped, so this cannot fall out of step with
        // `projection` the way listing each column by hand would.
        .groupBy(accounts.id)
        .orderBy(asc(accounts.sortOrder), asc(accounts.name))
    );
  }

  async findOne(id: string): Promise<AccountDto> {
    const [row] = await this.db.client
      .select(projection)
      .from(accounts)
      .where(and(eq(accounts.id, id), isNull(accounts.deletedAt)))
      .limit(1);

    if (!row) throw new NotFoundException("No such account");
    return row;
  }

  /**
   * Current balance per account: where it started, plus everything that moved.
   *
   * This was a Phase 2 stub that returned the *opening* balance under the name
   * `balance`, with a comment promising Phase 3 would add the movement. Phase 3
   * came and went. It was reporting ৳40,000 for a petty cash tin holding
   * ৳26,400, and understating the bank by ৳15.9 lakh — wrong money, from a
   * live permissioned endpoint, presented as current.
   *
   * Three things were wrong and all three are fixed:
   *
   *  - the movement is added, voided rows excluded, matching the register and
   *    the dashboard exactly;
   *  - archived accounts are included, because money in a closed account is
   *    still money and dropping it silently understates the total;
   *  - the total sums only accounts held in the base currency. It used to add
   *    a dollar-denominated card into a figure labelled BDT, which is wrong by
   *    the exchange rate and reads as perfectly normal. Anything in another
   *    currency is listed with its own, and left out of the total.
   */
  async balances() {
    /**
     * The same `currentBalance` expression the list uses, on purpose.
     *
     * This used to compute the figure its own way — a join, a group by, and
     * the addition done in JavaScript. Two places working out the same money
     * two different ways is how the dashboard and the Accounts screen come to
     * disagree, and the person looking at them has no way to tell which one to
     * believe.
     */
    const rows = await this.db.client
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.type,
        currency: accounts.currency,
        isActive: accounts.isActive,
        balance: currentBalance,
        ownBalance: ownCurrencyBalance,
        ownBalanceExact: ownCurrencyExact,
      })
      .from(accounts)
      .leftJoin(transactions, eq(transactions.accountId, accounts.id))
      .where(isNull(accounts.deletedAt))
      .groupBy(accounts.id)
      .orderBy(accounts.name);

    const settings = await this.settings.get();
    const base = settings.baseCurrency;

    const balances = rows.map((row) => ({
      ...row,
      balance: Number(row.balance).toFixed(2),
    }));

    const total = balances
      .filter((row) => row.currency === base)
      .reduce((sum, row) => sum + Number(row.balance), 0);

    return {
      accounts: balances,
      total: total.toFixed(2),
      currency: base,
    };
  }

  async create(input: CreateAccountInput, actor: AuthenticatedUser) {
    await this.assertNameFree(input.name);
    assertOpeningNotNegative(input.openingBalance);

    return this.audit.mutate({
      action: "create",
      entityTable: "accounts",
      summary: `Added ${ACCOUNT_TYPE_LABELS[input.type]} "${input.name}", opening ${formatMoney(
        input.openingBalance,
        { currency: input.currency },
      )} on ${input.openingBalanceOn}`,
      module: "accounts",
      read: () => Promise.resolve(undefined),
      run: async (tx) => {
        const [row] = await tx
          .insert(accounts)
          .values({
            ...input,
            createdBy: actor.id,
            updatedBy: actor.id,
          })
          .returning(projection);
        return row;
      },
    });
  }

  async update(
    id: string,
    input: UpdateAccountInput,
    actor: AuthenticatedUser,
  ) {
    const existing = await this.findOne(id);

    if (
      input.name &&
      input.name.toLowerCase() !== existing.name.toLowerCase()
    ) {
      await this.assertNameFree(input.name, id);
    }

    /**
     * The opening balance and its date are the base every later figure is
     * measured from. Once the period is closed they must not move, or every
     * report already issued for that period silently changes.
     */
    const movesOpening =
      (input.openingBalance !== undefined &&
        input.openingBalance !== existing.openingBalance) ||
      (input.openingBalanceOn !== undefined &&
        input.openingBalanceOn !== existing.openingBalanceOn);

    if (movesOpening) {
      await this.settings.assertPeriodOpen(
        input.openingBalanceOn ?? existing.openingBalanceOn,
      );
      await this.settings.assertPeriodOpen(existing.openingBalanceOn);
    }

    if (input.openingBalance !== undefined) {
      assertOpeningNotNegative(input.openingBalance);
    }
    // Snapshot only when the opening balance is actually changing — the
    // check below is gated the same way, and a rename should not pay for a
    // balance query it will never read.
    const openingChanging =
      input.openingBalance !== undefined &&
      input.openingBalance !== existing.openingBalance;
    const watch = openingChanging
      ? await overdraftWatch(this.db.client, [id])
      : null;

    return this.audit.mutate({
      action: "update",
      entityTable: "accounts",
      entityId: id,
      summary: describeUpdate(existing, input),
      module: "accounts",
      read: async (tx) => {
        const [row] = await tx
          .select(projection)
          .from(accounts)
          .where(eq(accounts.id, id))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        const [row] = await tx
          .update(accounts)
          .set({ ...input, updatedAt: new Date(), updatedBy: actor.id })
          .where(eq(accounts.id, id))
          .returning(projection);
        /*
         * Lowering the opening balance rewrites the account's whole history
         * downward, and can push a month that was fine below zero. Checked
         * only when the opening actually changed — an edit to the name must
         * not start failing because of entries typed since.
         */
        if (watch) {
          await watch.assert(tx);
        }
        return row;
      },
    });
  }

  /**
   * Accounts are archived, never deleted — transactions point at them, and a
   * deleted account would orphan its own history.
   */
  /**
   * Puts an archived account back into use.
   *
   * Archiving is a filing decision, not a deletion — the rows stay, the
   * balance stays, and a gateway switched off in March is very often switched
   * back on in September. Without this the only way back was a database
   * console, which is not a thing anybody should need for a reversible act.
   */
  async restore(id: string, actor: AuthenticatedUser) {
    const existing = await this.findOne(id);

    return this.audit.mutate({
      action: "update",
      entityTable: "accounts",
      entityId: id,
      summary: `Restored account "${existing.name}" from the archive`,
      module: "accounts",
      read: async (tx) => {
        const [row] = await tx
          .select(projection)
          .from(accounts)
          .where(eq(accounts.id, id))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        const [row] = await tx
          .update(accounts)
          .set({ isActive: true, updatedAt: new Date(), updatedBy: actor.id })
          .where(eq(accounts.id, id))
          .returning(projection);
        return row;
      },
    });
  }

  async archive(id: string, actor: AuthenticatedUser) {
    const existing = await this.findOne(id);

    return this.audit.mutate({
      action: "update",
      entityTable: "accounts",
      entityId: id,
      summary: `Archived account "${existing.name}"`,
      module: "accounts",
      read: async (tx) => {
        const [row] = await tx
          .select(projection)
          .from(accounts)
          .where(eq(accounts.id, id))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        const [row] = await tx
          .update(accounts)
          .set({ isActive: false, updatedAt: new Date(), updatedBy: actor.id })
          .where(eq(accounts.id, id))
          .returning(projection);
        return row;
      },
    });
  }

  /**
   * Everything that points at this account, counted.
   *
   * Read before the confirmation dialog is drawn, so the warning can name
   * figures instead of gesturing at "related records". It is also what decides
   * whether Delete is offered at all.
   */
  async attachments(id: string): Promise<AccountAttachments> {
    await this.findOne(id);

    const [txn] = await this.db.client
      .select({
        total: sql<number>`count(*)::int`,
        live: sql<number>`count(*) filter (where ${transactions.voidedAt} is null)::int`,
        first: sql<string | null>`min(${transactions.txnDate})::text`,
        last: sql<string | null>`max(${transactions.txnDate})::text`,
        // Voided rows are excluded here for the same reason every other total
        // in this application excludes them: they are struck through, not real.
        net: sql<string>`coalesce(sum(${transactions.signedAmount}) filter (where ${transactions.voidedAt} is null), 0)::text`,
      })
      .from(transactions)
      .where(eq(transactions.accountId, id));

    // Three separate queries rather than one helper: drizzle types a column to
    // its own table, so a generic "count rows in this table" does not typecheck
    // across three of them, and the workaround is worse than the repetition.
    const [tds] = await this.db.client
      .select({ n: sql<number>`count(*)::int` })
      .from(tdsDeposits)
      .where(eq(tdsDeposits.accountId, id));

    const [incomeTax] = await this.db.client
      .select({ n: sql<number>`count(*)::int` })
      .from(incomeTaxRecords)
      .where(eq(incomeTaxRecords.accountId, id));

    const [payroll] = await this.db.client
      .select({ n: sql<number>`count(*)::int` })
      .from(payrollRuns)
      .where(eq(payrollRuns.accountId, id));

    const total = txn?.total ?? 0;

    return {
      transactions: total,
      liveTransactions: txn?.live ?? 0,
      firstTxnDate: txn?.first ?? null,
      lastTxnDate: txn?.last ?? null,
      net: txn?.net ?? "0",
      tdsDeposits: tds?.n ?? 0,
      incomeTaxPayments: incomeTax?.n ?? 0,
      payrollRuns: payroll?.n ?? 0,
      deletable:
        total === 0 &&
        (tds?.n ?? 0) === 0 &&
        (incomeTax?.n ?? 0) === 0 &&
        (payroll?.n ?? 0) === 0,
    };
  }

  /**
   * Deletes an archived account that nothing points at.
   *
   * The request was for a delete that could optionally take the related
   * records with it, and that second half is not built - deliberately, and
   * this is the place to say why rather than in a commit message nobody will
   * find.
   *
   * `transactions.account_id` is NOT NULL with `on delete restrict`. That is
   * not an oversight to work around; it is the shape of the promise this
   * application makes. Every entry belongs to an account, the register's
   * closing balance is the account's opening balance plus everything that
   * moved through it, and "the register equals the bank statement" is true
   * because there is nowhere else for a figure to live. An entry with no
   * account cannot be shown on any screen in this app.
   *
   * So "delete the account, keep the entries" is not a feature that was
   * skipped. It is a sentence with no meaning here.
   *
   * That leaves deleting the entries too, and this application does not delete
   * money. Records are voided - struck through, out of every total, still
   * there. A finance system whose history can be removed is one whose history
   * cannot be relied on, and the deletion would silently rewrite every report
   * that period ever appeared in.
   *
   * What is left is the case that actually happens: an account added by
   * mistake, or one that never got used. Nothing points at it, nothing is
   * lost, and it goes. Anything else stays archived, which costs nothing - an
   * archived account is already out of every picker and every total.
   */
  async remove(id: string, actor: AuthenticatedUser) {
    const existing = await this.findOne(id);

    if (existing.isActive) {
      throw new BadRequestException(
        "Archive the account first. Deleting one that is still in use is not something to do in a single click.",
      );
    }

    const held = await this.attachments(id);
    if (!held.deletable) {
      throw new BadRequestException({
        message: describeWhyItStays(existing.name, held),
        errors: { account: [describeWhyItStays(existing.name, held)] },
      });
    }

    return this.audit.mutate({
      action: "delete",
      entityTable: "accounts",
      entityId: id,
      // Named in the summary, because a deletion is the one entry in the
      // trail with no "after" state to inspect later.
      summary: `${actor.fullName} deleted the empty archived account "${existing.name}"`,
      module: "accounts",
      read: async (tx) => {
        const [row] = await tx
          .select(projection)
          .from(accounts)
          .where(eq(accounts.id, id))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        // Conditioned on the account still being archived, so a restore racing
        // this cannot leave a live account deleted.
        const [row] = await tx
          .delete(accounts)
          .where(and(eq(accounts.id, id), eq(accounts.isActive, false)))
          .returning(projection);
        if (!row) {
          throw new BadRequestException(
            "The account changed while this was being confirmed. Look at it again.",
          );
        }
        return row;
      },
    });
  }

  private async assertNameFree(name: string, exceptId?: string) {
    const [clash] = await this.db.client
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          sql`lower(${accounts.name}) = ${name.toLowerCase()}`,
          isNull(accounts.deletedAt),
        ),
      )
      .limit(1);

    if (clash && clash.id !== exceptId) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: { name: ["An account with that name already exists"] },
      });
    }
  }
}

const projection = {
  id: accounts.id,
  name: accounts.name,
  type: accounts.type,
  bankName: accounts.bankName,
  branch: accounts.branch,
  accountNumber: accounts.accountNumber,
  routingNumber: accounts.routingNumber,
  swiftCode: accounts.swiftCode,
  currency: accounts.currency,
  openingBalance: accounts.openingBalance,
  openingBalanceUsd: accounts.openingBalanceUsd,
  openingBalanceOn: accounts.openingBalanceOn,

  /*
   * The card's readable half. `cardNumberSealed` and `cardCvcSealed` are NOT
   * here and must never be: this object feeds GET /accounts, the dashboard,
   * every account picker, the Accounts spreadsheet, and the before/after image
   * of every audit row on this table. `AccountDto` omits them at the type
   * level so adding either becomes a compile error rather than a leak.
   */
  cardHolderName: accounts.cardHolderName,
  cardLabel: accounts.cardLabel,
  cardLast4: accounts.cardLast4,
  cardExpiry: accounts.cardExpiry,
  cardSecretsSetAt: accounts.cardSecretsSetAt,
  cardSecretsSetBy: accounts.cardSecretsSetBy,

  sortOrder: accounts.sortOrder,
  isActive: accounts.isActive,
  notes: accounts.notes,
  createdAt: accounts.createdAt,
  updatedAt: accounts.updatedAt,
  createdBy: accounts.createdBy,
  updatedBy: accounts.updatedBy,
};

function describeUpdate(
  existing: AccountDto,
  input: UpdateAccountInput,
): string {
  const parts: string[] = [];
  if (input.name && input.name !== existing.name) {
    parts.push(`renamed to "${input.name}"`);
  }
  if (
    input.openingBalance !== undefined &&
    input.openingBalance !== existing.openingBalance
  ) {
    parts.push(
      `opening balance ${formatMoney(existing.openingBalance, {
        currency: existing.currency,
      })} → ${formatMoney(input.openingBalance, { currency: existing.currency })}`,
    );
  }
  if (
    input.openingBalanceOn !== undefined &&
    input.openingBalanceOn !== existing.openingBalanceOn
  ) {
    parts.push(
      `opening date ${existing.openingBalanceOn} → ${input.openingBalanceOn}`,
    );
  }
  if (input.isActive !== undefined && input.isActive !== existing.isActive) {
    parts.push(input.isActive ? "reactivated" : "archived");
  }
  const detail = parts.length ? parts.join(", ") : "details updated";
  return `Account "${existing.name}": ${detail}`;
}

/**
 * Why an account is staying, in the numbers the person is looking at.
 *
 * Written as a sentence rather than a code the screen has to translate,
 * because the screen is where somebody is deciding whether they have lost
 * something.
 */
function describeWhyItStays(name: string, held: AccountAttachments): string {
  const parts: string[] = [];
  if (held.transactions > 0) {
    parts.push(
      `${held.transactions} entr${held.transactions === 1 ? "y" : "ies"}` +
        (held.firstTxnDate
          ? ` from ${held.firstTxnDate} to ${held.lastTxnDate}`
          : ""),
    );
  }
  if (held.payrollRuns > 0)
    parts.push(
      `${held.payrollRuns} payroll run${held.payrollRuns === 1 ? "" : "s"}`,
    );
  if (held.tdsDeposits > 0)
    parts.push(
      `${held.tdsDeposits} TDS challan${held.tdsDeposits === 1 ? "" : "s"}`,
    );
  if (held.incomeTaxPayments > 0)
    parts.push(
      `${held.incomeTaxPayments} income tax payment${held.incomeTaxPayments === 1 ? "" : "s"}`,
    );

  return (
    `"${name}" still holds ${parts.join(", ")}. It stays archived rather than being deleted, ` +
    `because every entry has to belong to an account — the register's balance is built from that link, ` +
    `and this application voids money rather than deleting it. Archived is already out of every picker and every total.`
  );
}

/**
 * An account cannot open below zero, because it can never *be* below zero.
 *
 * The opening balance is the floor everything else stands on — a negative one
 * would make the account born overdrawn, and the rule the rest of the app
 * enforces on every entry would be broken before the first entry existed.
 */
function assertOpeningNotNegative(openingBalance: string) {
  if (Number(openingBalance) < 0) {
    throw new BadRequestException({
      message: "Validation failed",
      errors: {
        openingBalance: [
          "An opening balance cannot be negative — an account never goes below zero.",
        ],
      },
    });
  }
}

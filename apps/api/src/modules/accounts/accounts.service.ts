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
import { accounts, transactions, type Account } from "../../db/schema";
import { SettingsService } from "../settings/settings.service";

export type AccountDto = Omit<Account, "deletedAt" | "entityId">;

/**
 * An account as the Accounts screen needs it: what it holds *now*.
 *
 * `openingBalance` stays alongside rather than being replaced. It is a real
 * fact — the figure the books were opened at, and the base every later number
 * is computed from — and the screen shows it as the caption under the balance.
 */
export type AccountWithBalanceDto = AccountDto & { balance: string };

/**
 * Where an account stands: what it opened at, plus everything that has moved
 * through it since, with voided rows excluded.
 *
 * A correlated subquery rather than a join and a `group by`. The join version
 * is the same arithmetic and needs every selected column repeated in the
 * grouping — and the day somebody adds a column and forgets, the query either
 * fails or, worse, starts returning an account per distinct value of it.
 */
const currentBalance = sql<string>`(
  ${accounts.openingBalance} + coalesce((
    select sum(${transactions.signedAmount})
    from ${transactions}
    where ${transactions.accountId} = ${accounts.id}
      and ${transactions.voidedAt} is null
  ), 0)
)::text`;

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

    return this.db.client
      .select({ ...projection, balance: currentBalance })
      .from(accounts)
      .where(and(...filters))
      .orderBy(asc(accounts.sortOrder), asc(accounts.name));
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
      })
      .from(accounts)
      .where(isNull(accounts.deletedAt))
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
  openingBalanceOn: accounts.openingBalanceOn,
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

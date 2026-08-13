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
import { accounts, type Account } from "../../db/schema";
import { SettingsService } from "../settings/settings.service";

export type AccountDto = Omit<Account, "deletedAt" | "entityId">;

@Injectable()
export class AccountsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async list(query: ListAccountsQuery): Promise<AccountDto[]> {
    const filters = [isNull(accounts.deletedAt)];
    if (!query.includeInactive) filters.push(eq(accounts.isActive, true));

    return this.db.client
      .select(projection)
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
   * Current balance per account.
   *
   * Phase 2 has no ledger yet, so this is the opening balance. Phase 3 adds
   * `+ sum(signed_amount)` over the transactions — the shape of the response
   * stays the same so the dashboard does not change.
   */
  async balances() {
    const rows = await this.list({ includeInactive: false });
    const total = rows.reduce(
      (sum, row) => sum + Number(row.openingBalance),
      0,
    );
    return {
      accounts: rows.map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        currency: row.currency,
        balance: row.openingBalance,
      })),
      total: total.toFixed(2),
      currency: "BDT",
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

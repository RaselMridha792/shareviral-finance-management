import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  deriveCost,
  type CreateSubscriptionInput,
  type ListSubscriptionsQuery,
  type Paginated,
  type UpdateSubscriptionInput,
} from "@finance/shared";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import type { DbTransaction } from "../../db";
import { DbService } from "../../db/db.service";
import {
  accounts,
  files,
  subscriptions,
  subscriptionUsers,
  teamMembers,
  vendors,
} from "../../db/schema";

/**
 * The register of paid tools.
 *
 * Deliberately holds no totals. What a tool actually cost the company comes
 * from the ledger, where every other figure in this app comes from — a stored
 * "renews on the 3rd" is a habit rather than a schedule, and a monthly total
 * built from one would assert spending that may never have happened. The price
 * here is context: "about $20 a month".
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(
    query: ListSubscriptionsQuery,
  ): Promise<Paginated<SubscriptionRow>> {
    const filters = [isNull(subscriptions.deletedAt)];

    if (query.status) filters.push(eq(subscriptions.status, query.status));
    if (query.category)
      filters.push(eq(subscriptions.category, query.category));
    // Only ever matches the rows written before `tool_name` existed, because
    // nothing puts a company on a subscription now. Left working rather than
    // deleted: for those rows it is the one way to ask what was bought from a
    // particular company, and a filter that answers nothing is a different
    // thing from a filter that is gone.
    if (query.vendorId)
      filters.push(eq(subscriptions.vendorId, query.vendorId));

    if (query.q) {
      const like = `%${query.q}%`;
      // The tool's name too: somebody searching "Claude" is not thinking about
      // whether that is the plan or the tool.
      filters.push(
        or(
          sql`${this.toolNameSql()} ilike ${like}`,
          ilike(subscriptions.planName, like),
          ilike(subscriptions.boughtFor, like),
          ilike(subscriptions.loginEmail, like),
        )!,
      );
    }

    // "What is this person on" — an exists rather than a join, so a plan with
    // twelve people on it still comes back once.
    if (query.teamMemberId) {
      filters.push(
        sql`exists (
          select 1 from ${subscriptionUsers}
          where ${subscriptionUsers.subscriptionId} = ${subscriptions.id}
            and ${subscriptionUsers.teamMemberId} = ${query.teamMemberId}
        )`,
      );
    }

    const where = and(...filters);

    // Left, and that is not a tidy-up. `vendor_id` is nullable now and nothing
    // writes one, so an inner join would return only the rows from before the
    // name column and silently drop every subscription added since — a list
    // that looks perfectly healthy and is missing its newest half. The join is
    // here at all because the fallback name and the search read through it.
    const [{ total }] = await this.db.client
      .select({ total: count() })
      .from(subscriptions)
      .leftJoin(vendors, eq(subscriptions.vendorId, vendors.id))
      .where(where);

    const rows = await this.db.client
      .select(this.columns())
      .from(subscriptions)
      .leftJoin(vendors, eq(subscriptions.vendorId, vendors.id))
      .leftJoin(accounts, eq(subscriptions.accountId, accounts.id))
      .where(where)
      /*
       * Newest first, on the owner's instruction: something just bought is at
       * the top, where somebody who has just added it looks for it.
       *
       * This used to lead with the next renewal date, on the reasoning that
       * "what is about to bill" is the commonest question. It is not the
       * commonest *action* — adding a plan is — and a row that lands in the
       * middle of page one, sorted by a date the person adding it has not
       * thought about yet, reads as not having saved.
       *
       * `id` breaks the tie so the order is total. Two plans added in the same
       * second would otherwise swap places between page loads, which is how a
       * pager starts showing the same row twice.
       */
      .orderBy(desc(subscriptions.createdAt), desc(subscriptions.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const withUsers = await this.attachUsers(rows);

    return {
      items: withUsers,
      total: Number(total),
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(Number(total) / query.pageSize)),
    };
  }

  async get(id: string): Promise<SubscriptionRow> {
    const [row] = await this.db.client
      .select(this.columns())
      .from(subscriptions)
      // Left, for the same reason as the list: an inner join here is a 404 on
      // every subscription written since the name column arrived.
      .leftJoin(vendors, eq(subscriptions.vendorId, vendors.id))
      .leftJoin(accounts, eq(subscriptions.accountId, accounts.id))
      .where(and(eq(subscriptions.id, id), isNull(subscriptions.deletedAt)))
      .limit(1);

    if (!row) throw new NotFoundException("No such subscription");
    const [withUsers] = await this.attachUsers([row]);
    return withUsers;
  }

  /** Every tool one person is or has been on — the team page reads this. */
  /**
   * The plans one person is on — the whole plan, not a summary of it.
   *
   * This used to select ten fields of its own, and the profile could show four
   * columns because four was all it had. The owner asked for the same row the
   * subscriptions screen shows, so it selects `columns()` — the one list both
   * screens read — and adds only what is genuinely this person's rather than
   * the plan's: their seat's status and the dates their access ran between.
   *
   * `status` is therefore the plan's, the same as everywhere else, and
   * `seatStatus` is theirs. Naming the person's status `status` is what made
   * the old shape need a second field called `planStatus`, and a screen
   * reading the wrong one of those two is a mistake nothing catches.
   */
  async forMember(teamMemberId: string) {
    const rows = await this.db.client
      .select({
        ...this.columns(),
        seatStatus: subscriptionUsers.status,
        fromDate: subscriptionUsers.fromDate,
        untilDate: subscriptionUsers.untilDate,
      })
      .from(subscriptionUsers)
      .innerJoin(
        subscriptions,
        eq(subscriptionUsers.subscriptionId, subscriptions.id),
      )
      .leftJoin(vendors, eq(subscriptions.vendorId, vendors.id))
      .leftJoin(accounts, eq(subscriptions.accountId, accounts.id))
      .where(
        and(
          eq(subscriptionUsers.teamMemberId, teamMemberId),
          isNull(subscriptions.deletedAt),
        ),
      )
      // Newest first, as on the subscriptions screen. Two tables showing the
      // same rows in two orders is two tables somebody has to read twice.
      .orderBy(desc(subscriptions.createdAt), desc(subscriptions.id));

    // The other people on each plan. A shared plan's cost is the whole plan's,
    // and knowing thirteen names are on it is what stops somebody reading that
    // figure as this person's.
    return this.attachUsers(rows);
  }

  async create(input: CreateSubscriptionInput, actor: AuthenticatedUser) {
    const values = this.moneyOf(input);
    await this.assertMembersExist(input.users.map((u) => u.teamMemberId));

    return this.audit.mutate({
      action: "create",
      entityTable: "subscriptions",
      summary: `${actor.fullName} added the ${input.planName} subscription`,
      module: "subscriptions",
      read: () => Promise.resolve(undefined),
      run: async (tx) => {
        const [row] = await tx
          .insert(subscriptions)
          .values({
            toolName: input.toolName,
            planName: input.planName,
            category: input.category,
            status: input.status,
            ...values,
            billingCycle: input.billingCycle,
            startDate: input.startDate,
            nextRenewalOn: input.nextRenewalOn ?? null,
            renewalNote: input.renewalNote ?? null,
            paymentMethod: input.paymentMethod,
            accountId: input.accountId ?? null,
            boughtFor: input.boughtFor ?? null,
            loginEmail: input.loginEmail ?? null,
            websiteUrl: input.websiteUrl ?? null,
            invoiceNo: input.invoiceNo ?? null,
            reference: input.reference ?? null,
            notes: input.notes ?? null,
            createdBy: actor.id,
            updatedBy: actor.id,
          })
          .returning();

        await this.replaceUsers(tx, row.id, input.users, actor);
        return row;
      },
    });
  }

  async update(
    id: string,
    input: UpdateSubscriptionInput,
    actor: AuthenticatedUser,
  ) {
    const existing = await this.get(id);
    if (input.users) {
      await this.assertMembersExist(input.users.map((u) => u.teamMemberId));
    }

    // The three money fields only tie out against each other, so a change to
    // one has to be checked against what is already stored rather than against
    // the two-thirds of a triple that arrived.
    const merged = this.moneyOf({
      costUsd: input.costUsd ?? existing.costUsd,
      costBdt: input.costBdt ?? existing.costBdt ?? undefined,
      usdRate: input.usdRate ?? existing.usdRate ?? undefined,
    });

    return this.audit.mutate({
      action: "update",
      entityTable: "subscriptions",
      entityId: id,
      summary: `${actor.fullName} changed the ${existing.planName} subscription`,
      module: "subscriptions",
      read: async (tx) => {
        const [row] = await tx
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.id, id))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        const { users, ...rest } = input;
        await tx
          .update(subscriptions)
          .set({
            ...rest,
            // Only when money was actually in the body: otherwise an edit to
            // the plan name would rewrite a rate somebody had corrected by
            // hand.
            ...(input.costUsd !== undefined ||
            input.costBdt !== undefined ||
            input.usdRate !== undefined
              ? merged
              : {}),
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(eq(subscriptions.id, id));

        // Absent means "leave the seats alone". An empty array means "nobody
        // is on this", which is a real and different instruction.
        if (users) await this.replaceUsers(tx, id, users, actor);
      },
    });
  }

  /**
   * Soft delete.
   *
   * A cancelled subscription is a status, not a deletion — this is for the row
   * that should never have been typed. The seats go with it, because a join
   * row pointing at a subscription nobody can see would keep the tool on
   * somebody's profile forever.
   */
  async remove(id: string, actor: AuthenticatedUser) {
    const existing = await this.get(id);

    return this.audit.mutate({
      action: "delete",
      entityTable: "subscriptions",
      entityId: id,
      summary: `${actor.fullName} removed the ${existing.planName} subscription`,
      module: "subscriptions",
      read: async (tx) => {
        const [row] = await tx
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.id, id))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        await tx
          .update(subscriptions)
          .set({ deletedAt: new Date(), updatedBy: actor.id })
          .where(eq(subscriptions.id, id));
        await tx
          .delete(subscriptionUsers)
          .where(eq(subscriptionUsers.subscriptionId, id));
      },
    });
  }

  /* ------------------------------------------------------------------ */

  /**
   * What the tool is called.
   *
   * `tool_name` on everything written since it arrived, and the name of the
   * company the plan used to hang off for everything older — those rows were
   * only ever labelled by the `vendors` row the form minted for them, so the
   * fallback is this register's whole history until today.
   *
   * Built in SQL rather than chosen in TypeScript because the list orders on
   * it and the search matches it, and both of those happen in Postgres.
   */
  private toolNameSql() {
    return sql<string>`coalesce(${subscriptions.toolName}, ${vendors.name})`;
  }

  private columns() {
    return {
      id: subscriptions.id,
      toolName: this.toolNameSql(),
      /**
       * Null on everything written since the name column arrived, and that is
       * all it is: which company an old plan was bought from. Nothing sets it,
       * and no screen has to show it.
       */
      vendorId: subscriptions.vendorId,
      planName: subscriptions.planName,
      category: subscriptions.category,
      status: subscriptions.status,
      costUsd: subscriptions.costUsd,
      costBdt: subscriptions.costBdt,
      usdRate: subscriptions.usdRate,
      billingCycle: subscriptions.billingCycle,
      startDate: subscriptions.startDate,
      nextRenewalOn: subscriptions.nextRenewalOn,
      renewalNote: subscriptions.renewalNote,
      paymentMethod: subscriptions.paymentMethod,
      accountId: subscriptions.accountId,
      accountName: accounts.name,
      boughtFor: subscriptions.boughtFor,
      loginEmail: subscriptions.loginEmail,
      websiteUrl: subscriptions.websiteUrl,
      invoiceNo: subscriptions.invoiceNo,
      reference: subscriptions.reference,
      /**
       * The plan screenshot, found rather than pointed at.
       *
       * The file carries the subscription's id and the subscription carries no
       * column back — one direction, so the two cannot disagree the first time
       * somebody deletes the file. The kind is singular, so there is at most
       * one live row to find.
       */
      screenshotFileId: sql<string | null>`(
        select f.id from ${files} f
        where f.subscription_id = ${subscriptions.id}
          and f.kind = 'subscription_screenshot'
          and f.deleted_at is null
        limit 1
      )`,
      /*
       * The paperwork on the plan, not counting the plan's own screenshot —
       * the invoice and the bank's record, which are what the two number
       * cells open. A plan with no transaction id draws an eye instead of a
       * dash, and the eye must not offer an empty drawer.
       */
      documentCount: sql<number>`(
        select count(*)::int from ${files} f
        where f.subscription_id = ${subscriptions.id}
          and f.kind <> 'subscription_screenshot'
          and f.deleted_at is null
      )`,
      notes: subscriptions.notes,
    };
  }

  /**
   * The seats, in one query for the whole page.
   *
   * Not per row: twenty-four subscriptions on screen would be twenty-four
   * round trips, and this list is the one screen where every row has people on
   * it.
   */
  /*
   * Generic, so what a caller selects on top of the standard row is still
   * there on the way out. `rows: SubscriptionRow[]` widened every row to the
   * standard shape, which meant `forMember` could not carry the seat's own
   * dates through without the compiler forgetting they existed.
   */
  private async attachUsers<T extends SubscriptionRow>(rows: T[]) {
    if (rows.length === 0) return [];

    const seats = await this.db.client
      .select({
        subscriptionId: subscriptionUsers.subscriptionId,
        teamMemberId: subscriptionUsers.teamMemberId,
        fullName: teamMembers.fullName,
        status: subscriptionUsers.status,
        fromDate: subscriptionUsers.fromDate,
        untilDate: subscriptionUsers.untilDate,
      })
      .from(subscriptionUsers)
      .innerJoin(
        teamMembers,
        eq(subscriptionUsers.teamMemberId, teamMembers.id),
      )
      .where(
        inArray(
          subscriptionUsers.subscriptionId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(
        asc(teamMembers.joinedOn),
        asc(teamMembers.fullName),
        asc(teamMembers.id),
      );

    const byId = new Map<string, typeof seats>();
    for (const seat of seats) {
      const list = byId.get(seat.subscriptionId) ?? [];
      list.push(seat);
      byId.set(seat.subscriptionId, list);
    }

    return rows.map((row) => ({ ...row, users: byId.get(row.id) ?? [] }));
  }

  /**
   * The seats become exactly what was sent.
   *
   * Deleted and re-inserted rather than diffed: the list is small, its only
   * identity is the pair of ids, and a half-applied change would leave
   * somebody holding a seat the sender meant to take away — which is the one
   * outcome this register exists to prevent.
   */
  private async replaceUsers(
    tx: DbTransaction,
    subscriptionId: string,
    users: CreateSubscriptionInput["users"],
    actor: AuthenticatedUser,
  ) {
    await tx
      .delete(subscriptionUsers)
      .where(eq(subscriptionUsers.subscriptionId, subscriptionId));

    if (users.length === 0) return;

    await tx.insert(subscriptionUsers).values(
      users.map((user) => ({
        subscriptionId,
        teamMemberId: user.teamMemberId,
        fromDate: user.fromDate ?? null,
        untilDate: user.untilDate ?? null,
        status: user.status,
        createdBy: actor.id,
      })),
    );
  }

  /**
   * The third money field, worked out from the two that were given.
   *
   * The schema has already refused a triple that does not agree; this fills in
   * the one that was left out, so the row never holds two of three and a
   * screen never has to guess the missing one.
   */
  private moneyOf(input: {
    costUsd?: string;
    costBdt?: string;
    usdRate?: string;
  }) {
    const derived = deriveCost(input);
    return {
      costUsd: derived.costUsd ?? "0.00",
      costBdt: derived.costBdt ?? null,
      usdRate: derived.usdRate ?? null,
    };
  }

  /**
   * Everybody named is really on the team.
   *
   * Checked here rather than left to the foreign key: a bad id would otherwise
   * surface as a driver error, which is neither a ZodError nor an
   * HttpException and reaches the browser as a bare 500.
   */
  private async assertMembersExist(ids: string[]) {
    if (ids.length === 0) return;

    const found = await this.db.client
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(
        and(
          inArray(teamMembers.id, [...new Set(ids)]),
          isNull(teamMembers.deletedAt),
        ),
      );

    if (found.length !== new Set(ids).size) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: { users: ["Somebody on this list is no longer on the team"] },
      });
    }
  }
}

type SubscriptionRow = {
  id: string;
  toolName: string;
  vendorId: string | null;
  planName: string;
  category: string;
  status: string;
  costUsd: string;
  costBdt: string | null;
  usdRate: string | null;
  billingCycle: string;
  startDate: string;
  nextRenewalOn: string | null;
  renewalNote: string | null;
  paymentMethod: string;
  accountId: string | null;
  accountName: string | null;
  boughtFor: string | null;
  loginEmail: string | null;
  websiteUrl: string | null;
  invoiceNo: string | null;
  reference: string | null;
  screenshotFileId: string | null;
  documentCount: number;
  notes: string | null;
};

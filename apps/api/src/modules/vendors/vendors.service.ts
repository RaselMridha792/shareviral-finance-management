import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  VENDOR_TYPE_LABELS,
  fromMinorUnits,
  isFutureMonth,
  monthRange,
  parseIsoDate,
  toMinorUnits,
  todayInDhaka,
  type BillingCycle,
  type CreateVendorInput,
  type ListVendorsQuery,
  type Paginated,
  type SubscriptionLine,
  type SubscriptionSummary,
  type UpdateVendorInput,
} from "@finance/shared";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import type { DbTransaction } from "../../db";
import { DbService } from "../../db/db.service";
import { accounts, transactions, vendors, type Vendor } from "../../db/schema";
import { notATransfer } from "../transactions/own-money";
import { isToolSpend, isToolVendor } from "./tool-spend";

/**
 * `nextRenewalOn` is deliberately not returned.
 *
 * The column still exists — dropping it is not worth a migration — but these
 * are bought month by month rather than on a schedule, so a stored renewal
 * date is not something the app may present. Leaving it on the DTO is an
 * invitation to render it again.
 */
export type VendorDto = Omit<
  Vendor,
  "deletedAt" | "deletedBy" | "deleteReason" | "entityId" | "nextRenewalOn"
>;

@Injectable()
export class VendorsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListVendorsQuery): Promise<Paginated<VendorDto>> {
    const filters = [isNull(vendors.deletedAt)];
    if (!query.includeInactive) filters.push(eq(vendors.isActive, true));
    if (query.type) filters.push(eq(vendors.type, query.type));
    if (query.q) {
      const term = `%${query.q}%`;
      const match = or(
        ilike(vendors.name, term),
        ilike(vendors.contactName, term),
        ilike(vendors.phone, term),
        ilike(vendors.etin, term),
      );
      if (match) filters.push(match);
    }

    const where = and(...filters);
    const offset = (query.page - 1) * query.pageSize;

    const [items, [{ total }]] = await Promise.all([
      this.db.client
        .select(projection)
        .from(vendors)
        .where(where)
        .orderBy(asc(vendors.name))
        .limit(query.pageSize)
        .offset(offset),
      this.db.client.select({ total: count() }).from(vendors).where(where),
    ]);

    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total: Number(total),
      totalPages: Math.max(1, Math.ceil(Number(total) / query.pageSize)),
    };
  }

  /** Typeahead for the transaction form's combobox. */
  async search(term: string, limit = 10): Promise<VendorDto[]> {
    const trimmed = term.trim();
    const filters = [isNull(vendors.deletedAt), eq(vendors.isActive, true)];
    if (trimmed) filters.push(ilike(vendors.name, `%${trimmed}%`));

    return (
      this.db.client
        .select(projection)
        .from(vendors)
        .where(and(...filters))
        // Names that start with the term first, then the rest alphabetically.
        .orderBy(
          desc(
            sql`(lower(${vendors.name}) like ${trimmed.toLowerCase() + "%"})`,
          ),
          asc(vendors.name),
        )
        .limit(limit)
    );
  }

  async findOne(id: string): Promise<VendorDto> {
    const [row] = await this.db.client
      .select(projection)
      .from(vendors)
      .where(and(eq(vendors.id, id), isNull(vendors.deletedAt)))
      .limit(1);

    if (!row) throw new NotFoundException("No such vendor");
    return row;
  }

  /**
   * Resolves a vendor by id, or creates one from a typed name.
   *
   * Used by the transaction form so a new payee can be added without leaving
   * the form. Runs inside the caller's transaction so a failed transaction
   * does not leave a stray vendor behind.
   */
  async resolveOrCreate(
    tx: DbTransaction,
    input: { vendorId?: string | null; vendorName?: string | null },
    actor: AuthenticatedUser,
  ): Promise<string | null> {
    if (input.vendorId) return input.vendorId;

    const name = input.vendorName?.trim();
    if (!name) return null;

    // A name that is only digits is a figure that landed in the wrong box —
    // an amount tabbed into "Paid to", most often. Creating a vendor called
    // "150000.00" is silent and permanent, and the master list is the one
    // place in this app where a typo propagates to every future entry.
    if (/^[\d\s.,\-৳$]+$/.test(name)) {
      throw new BadRequestException(
        `"${name}" looks like an amount, not a name. Put the figure in the amount box and leave this one for who was paid.`,
      );
    }

    const [existing] = await tx
      .select({ id: vendors.id })
      .from(vendors)
      .where(
        and(
          sql`lower(${vendors.name}) = ${name.toLowerCase()}`,
          isNull(vendors.deletedAt),
        ),
      )
      .limit(1);

    if (existing) return existing.id;

    const [created] = await tx
      .insert(vendors)
      .values({ name, createdBy: actor.id, updatedBy: actor.id })
      .returning({ id: vendors.id });

    return created.id;
  }

  async create(input: CreateVendorInput, actor: AuthenticatedUser) {
    await this.assertNameFree(input.name);

    return this.audit.mutate({
      action: "create",
      entityTable: "vendors",
      summary: `Added ${VENDOR_TYPE_LABELS[input.type].toLowerCase()} "${input.name}"`,
      module: "vendors",
      read: () => Promise.resolve(undefined),
      run: async (tx) => {
        const [row] = await tx
          .insert(vendors)
          .values({ ...input, createdBy: actor.id, updatedBy: actor.id })
          .returning(projection);
        return row;
      },
    });
  }

  async update(id: string, input: UpdateVendorInput, actor: AuthenticatedUser) {
    const existing = await this.findOne(id);

    if (
      input.name &&
      input.name.toLowerCase() !== existing.name.toLowerCase()
    ) {
      await this.assertNameFree(input.name, id);
    }

    return this.audit.mutate({
      action: "update",
      entityTable: "vendors",
      entityId: id,
      summary: describeUpdate(existing, input),
      module: "vendors",
      read: async (tx) => {
        const [row] = await tx
          .select(projection)
          .from(vendors)
          .where(eq(vendors.id, id))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        const [row] = await tx
          .update(vendors)
          .set({ ...input, updatedAt: new Date(), updatedBy: actor.id })
          .where(eq(vendors.id, id))
          .returning(projection);
        return row;
      },
    });
  }

  /**
   * The tools the company uses, and what was actually paid for them.
   *
   * Nothing here is projected. These get bought some months and not others, so
   * the stored cycle and price are carried as context — "about $20 a month" —
   * while every figure comes from the ledger. The question the screen exists to
   * answer is "have I bought Claude this month", which only the ledger knows.
   *
   * The period is a calendar month — the unit the buying decision is made in —
   * and defaults to this one. Any earlier month can be asked for, because "did
   * we pay for Claude in June" is a question that gets asked in August.
   */
  /**
   * The billing half of a plan: what it costs, on which card, how often.
   *
   * `VendorDto` deliberately does not carry these — it is the shape the vendor
   * screens read — so recording a payment asks for them by name rather than
   * widening a DTO that twenty other callers already have.
   */
  async billingPlan(id: string) {
    const [row] = await this.db.client
      .select({
        id: vendors.id,
        name: vendors.name,
        billingCycle: vendors.billingCycle,
        billingAmount: vendors.billingAmount,
        billingCurrency: vendors.billingCurrency,
        billingAccountId: vendors.billingAccountId,
        defaultCategoryId: vendors.defaultCategoryId,
        nextRenewalOn: vendors.nextRenewalOn,
      })
      .from(vendors)
      .where(and(eq(vendors.id, id), isNull(vendors.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Move the renewal date on, after a payment was recorded for this plan.
   *
   * A setter rather than letting the transactions side write to `vendors`
   * directly: the renewal is this module's fact, and one door to it is what
   * keeps a second caller from setting it a different way.
   */
  async setNextRenewal(id: string, on: string, actor: AuthenticatedUser) {
    await this.db.client
      .update(vendors)
      .set({ nextRenewalOn: on, updatedAt: new Date(), updatedBy: actor.id })
      .where(eq(vendors.id, id));
  }

  async subscriptions(
    asked: { year?: number; month?: number } = {},
  ): Promise<SubscriptionSummary> {
    /**
     * Any month up to this one, defaulting to this one.
     *
     * A future month is refused rather than answered with zeros: "nothing was
     * paid in October" and "October has not happened" are different facts, and
     * a screen full of zeros states the first when it means the second.
     */
    if (asked.year && asked.month && isFutureMonth(asked.year, asked.month)) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: { month: "That month has not happened yet." },
      });
    }

    const today = parseIsoDate(todayInDhaka());
    const period = monthRange(
      asked.year ?? today.year,
      asked.month ?? today.month,
    );

    const inPeriod = sql`${transactions.txnDate} between ${period.start} and ${period.end}`;

    const [tools, ledger, [total]] = await Promise.all([
      this.db.client
        .select({
          id: vendors.id,
          name: vendors.name,
          type: vendors.type,
          billingCycle: vendors.billingCycle,
          billingAmount: vendors.billingAmount,
          billingCurrency: vendors.billingCurrency,
          billingAccountId: vendors.billingAccountId,
          billingAccountName: accounts.name,
        })
        .from(vendors)
        .leftJoin(accounts, eq(vendors.billingAccountId, accounts.id))
        .where(
          and(
            isNull(vendors.deletedAt),
            eq(vendors.isActive, true),
            isToolVendor(),
          ),
        )
        .orderBy(asc(vendors.name)),

      // One pass over the outgoing ledger for both figures. `last paid` is
      // deliberately all-time: "last bought in April" is the answer somebody
      // needs when this month is empty, and a period-bound max would just
      // repeat what the period column already says.
      this.db.client
        .select({
          vendorId: transactions.vendorId,
          paid: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${inPeriod}), 0)::text`,
          entries: sql<number>`(count(*) filter (where ${inPeriod}))::int`,
          lastPaidOn: sql<string | null>`max(${transactions.txnDate})::text`,
        })
        .from(transactions)
        .where(
          and(
            isNull(transactions.voidedAt),
            eq(transactions.direction, "out"),
            isNotNull(transactions.vendorId),
          ),
        )
        .groupBy(transactions.vendorId),

      // The headline, by the same rule the overview's tooling tile uses — so
      // the dashboard and this screen cannot show different numbers for the
      // same month. It also picks up card spend nobody attributed to a named
      // tool, which is why it can exceed the sum of the lines.
      //
      // `notATransfer()` for the reason written out beside the overview's copy:
      // isToolSpend() calls any row on the non-taka card tooling, and moving a
      // top-up back off that card is not a purchase. The per-vendor `paid`
      // above needs no such clause — it demands a vendor_id, and a transfer has
      // none. That promise of matching numbers is why this cannot be fixed on
      // one side only.
      this.db.client
        .select({
          total: sql<string>`coalesce(sum(${transactions.amount}), 0)::text`,
        })
        .from(transactions)
        .leftJoin(vendors, eq(transactions.vendorId, vendors.id))
        .leftJoin(accounts, eq(transactions.accountId, accounts.id))
        .where(
          and(
            gte(transactions.txnDate, period.start),
            lte(transactions.txnDate, period.end),
            isNull(transactions.voidedAt),
            eq(transactions.direction, "out"),
            notATransfer(),
            isToolSpend(),
          ),
        ),
    ]);

    const byVendor = new Map(ledger.map((row) => [row.vendorId, row]));

    const lines: SubscriptionLine[] = tools.map((tool) => {
      const spend = byVendor.get(tool.id);
      return {
        id: tool.id,
        name: tool.name,
        type: tool.type,
        billingCycle: tool.billingCycle as BillingCycle,
        billingAmount: tool.billingAmount,
        billingCurrency: tool.billingCurrency,
        paidThisPeriod: Number(spend?.paid ?? 0).toFixed(2),
        entriesThisPeriod: Number(spend?.entries ?? 0),
        lastPaidOn: spend?.lastPaidOn ?? null,
        billingAccountId: tool.billingAccountId,
        billingAccountName: tool.billingAccountName,
      };
    });

    // What the headline covers that no named tool does — card spending nobody
    // attributed. Poisha, not floats: a difference of two ledger figures is
    // exactly where binary floating point goes wrong.
    const paid = toMinorUnits(Number(total.total).toFixed(2));
    const named = lines.reduce(
      (sum, line) => sum + toMinorUnits(line.paidThisPeriod),
      0n,
    );

    return {
      period: { label: period.label, start: period.start, end: period.end },
      paidThisPeriod: fromMinorUnits(paid),
      unattributed: fromMinorUnits(paid > named ? paid - named : 0n),
      lines,
    };
  }

  private async assertNameFree(name: string, exceptId?: string) {
    const [clash] = await this.db.client
      .select({ id: vendors.id })
      .from(vendors)
      .where(
        and(
          sql`lower(${vendors.name}) = ${name.toLowerCase()}`,
          isNull(vendors.deletedAt),
        ),
      )
      .limit(1);

    if (clash && clash.id !== exceptId) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: { name: ["A vendor with that name already exists"] },
      });
    }
  }
}

const projection = {
  id: vendors.id,
  name: vendors.name,
  type: vendors.type,
  etin: vendors.etin,
  bin: vendors.bin,
  psrStatus: vendors.psrStatus,
  psrAssessmentYear: vendors.psrAssessmentYear,
  psrReference: vendors.psrReference,
  contactName: vendors.contactName,
  phone: vendors.phone,
  email: vendors.email,
  address: vendors.address,
  defaultCategoryId: vendors.defaultCategoryId,
  billingCycle: vendors.billingCycle,
  billingAmount: vendors.billingAmount,
  billingCurrency: vendors.billingCurrency,
  billingAccountId: vendors.billingAccountId,
  /*
   * In the projection as well as the schema. The columns kept storing and the
   * screen kept reading N/A on accounts and on team members for exactly this
   * reason, twice — this object is what the API actually answers with.
   */
  reference: vendors.reference,
  notes: vendors.notes,
  isActive: vendors.isActive,
  createdAt: vendors.createdAt,
  updatedAt: vendors.updatedAt,
  createdBy: vendors.createdBy,
  updatedBy: vendors.updatedBy,
};

function describeUpdate(existing: VendorDto, input: UpdateVendorInput): string {
  const parts: string[] = [];
  if (input.name && input.name !== existing.name) {
    parts.push(`renamed to "${input.name}"`);
  }
  if (input.etin !== undefined && input.etin !== existing.etin) {
    parts.push(input.etin ? "e-TIN recorded" : "e-TIN removed");
  }
  if (input.psrStatus && input.psrStatus !== existing.psrStatus) {
    // Worth naming in the log: missing PSR raises the TDS rate by 50%.
    parts.push(`PSR ${existing.psrStatus} → ${input.psrStatus}`);
  }
  if (input.isActive !== undefined && input.isActive !== existing.isActive) {
    parts.push(input.isActive ? "reactivated" : "deactivated");
  }
  const detail = parts.length ? parts.join(", ") : "details updated";
  return `Vendor "${existing.name}": ${detail}`;
}

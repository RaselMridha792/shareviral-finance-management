import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  VENDOR_TYPE_LABELS,
  daysBetween,
  monthlyEquivalent,
  nextRenewal,
  todayInDhaka,
  type CreateVendorInput,
  type ListVendorsQuery,
  type Paginated,
  type SubscriptionLine,
  type SubscriptionSummary,
  type UpdateVendorInput,
} from "@finance/shared";
import { and, asc, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import type { DbTransaction } from "../../db";
import { DbService } from "../../db/db.service";
import { accounts, vendors, type Vendor } from "../../db/schema";

export type VendorDto = Omit<Vendor, "deletedAt" | "entityId">;

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
   * Everything that renews, with the next date rolled forward.
   *
   * The stored date is an anchor somebody set once; this is what it means
   * today. Totals stay split by the currency each is billed in — most AI tools
   * charge dollars while the books are taka, and one number covering both
   * would be wrong by the exchange rate and look entirely normal.
   */
  async subscriptions(): Promise<SubscriptionSummary> {
    const today = todayInDhaka();

    const rows = await this.db.client
      .select({
        id: vendors.id,
        name: vendors.name,
        type: vendors.type,
        billingCycle: vendors.billingCycle,
        billingAmount: vendors.billingAmount,
        billingCurrency: vendors.billingCurrency,
        anchor: vendors.nextRenewalOn,
        billingAccountId: vendors.billingAccountId,
        billingAccountName: accounts.name,
      })
      .from(vendors)
      .leftJoin(accounts, eq(vendors.billingAccountId, accounts.id))
      .where(
        and(
          isNull(vendors.deletedAt),
          eq(vendors.isActive, true),
          sql`${vendors.billingCycle} <> 'none'`,
        ),
      );

    let monthlyBdt = 0;
    let monthlyUsd = 0;

    const lines: SubscriptionLine[] = rows.map((row) => {
      const cycle = row.billingCycle as SubscriptionLine["billingCycle"];
      const per = monthlyEquivalent(row.billingAmount, cycle);
      if (row.billingCurrency === "USD") monthlyUsd += per;
      else monthlyBdt += per;

      const next = nextRenewal(row.anchor, cycle, today);

      return {
        id: row.id,
        name: row.name,
        type: row.type,
        billingCycle: cycle,
        billingAmount: row.billingAmount,
        billingCurrency: row.billingCurrency,
        nextRenewalOn: next,
        daysAway: next ? daysBetween(today, next) : null,
        billingAccountId: row.billingAccountId,
        billingAccountName: row.billingAccountName,
      };
    });

    // Soonest first, and anything with no date at the end — it is not urgent,
    // it is unfinished.
    lines.sort((a, b) => {
      if (a.nextRenewalOn === b.nextRenewalOn)
        return a.name.localeCompare(b.name);
      if (!a.nextRenewalOn) return 1;
      if (!b.nextRenewalOn) return -1;
      return a.nextRenewalOn < b.nextRenewalOn ? -1 : 1;
    });

    return {
      monthlyBdt: monthlyBdt.toFixed(2),
      monthlyUsd: monthlyUsd.toFixed(2),
      lines,
      dueSoon: lines.filter((l) => l.daysAway !== null && l.daysAway <= 7),
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
  nextRenewalOn: vendors.nextRenewalOn,
  billingAccountId: vendors.billingAccountId,
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

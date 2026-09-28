import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Paginated } from "@finance/shared";
import { and, count, desc, eq, ilike, isNull, ne, or, sql } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import type { DbTransaction } from "../../db";
import { DbService } from "../../db/db.service";
import { invoices, users } from "../../db/schema";
import {
  readInvoice,
  type InvoiceDocument,
  type ListInvoicesQuery,
  type SaveInvoiceInput,
} from "./invoice-document";

/** One invoice as the list shows it. */
export type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  status: string;
  clientName: string | null;
  /** From the document: what somebody remembers an invoice by. */
  projectTitle: string | null;
  issuedOn: string | null;
  dueOn: string | null;
  totalAmount: string;
  usdRate: string | null;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
};

export type InvoiceDto = InvoiceRow & { document: InvoiceDocument };

/**
 * Saved invoices — the Invoice Builder's documents, kept.
 *
 * The owner, 29 Sep 2026: *"All invoice a table format a invoice gula save
 * thakbe. okhan theke view kora jabe, edit kora jabe, delete kora jabe"*.
 *
 * Deleting is the trash's, like every other row in the app (`trash.registry
 * .ts`, kind "invoice"), so a deleted invoice can be put back from Settings →
 * Trashed. Nothing here touches the ledger: an invoice is a document the
 * company sent, not money that moved.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private readonly columns = {
    id: invoices.id,
    invoiceNumber: invoices.invoiceNumber,
    status: invoices.status,
    clientName: invoices.clientName,
    projectTitle: sql<
      string | null
    >`nullif(${invoices.document} ->> 'projectTitle', '')`,
    issuedOn: invoices.issuedOn,
    dueOn: invoices.dueOn,
    totalAmount: invoices.totalAmount,
    usdRate: invoices.usdRate,
    createdAt: sql<string>`${invoices.createdAt}::text`,
    updatedAt: sql<string>`${invoices.updatedAt}::text`,
    createdByName: users.fullName,
  };

  async list(query: ListInvoicesQuery): Promise<Paginated<InvoiceRow>> {
    const filters = [isNull(invoices.deletedAt)];
    if (query.status) filters.push(eq(invoices.status, query.status));
    if (query.q) {
      const like = `%${query.q}%`;
      filters.push(
        or(
          ilike(invoices.invoiceNumber, like),
          ilike(invoices.clientName, like),
          // The project title, which is what somebody remembers an invoice by
          // as often as its number.
          sql`${invoices.document} ->> 'projectTitle' ilike ${like}`,
        )!,
      );
    }
    const where = and(...filters);

    const [items, [{ total }]] = await Promise.all([
      this.db.client
        .select(this.columns)
        .from(invoices)
        .leftJoin(users, eq(users.id, invoices.createdBy))
        .where(where)
        // Newest first, the owner's rule for every list. An invoice with no
        // date sorts by when it was saved.
        .orderBy(
          sql`${invoices.issuedOn} desc nulls last`,
          desc(invoices.createdAt),
        )
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.client.select({ total: count() }).from(invoices).where(where),
    ]);

    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total: Number(total),
      totalPages: Math.max(1, Math.ceil(Number(total) / query.pageSize)),
    };
  }

  async get(id: string): Promise<InvoiceDto> {
    const [row] = await this.db.client
      .select({ ...this.columns, document: invoices.document })
      .from(invoices)
      .leftJoin(users, eq(users.id, invoices.createdBy))
      .where(and(eq(invoices.id, id), isNull(invoices.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException("That invoice is not here");
    return { ...row, document: row.document as InvoiceDocument };
  }

  /**
   * The number a new invoice is offered: the last one saved, plus one, in its
   * own shape — INV-009 → INV-010, 2026/41 → 2026/42. A number already taken
   * is stepped past. With nothing saved yet, INV-001.
   */
  async nextNumber(): Promise<{ number: string }> {
    const [last] = await this.db.client
      .select({ number: invoices.invoiceNumber })
      .from(invoices)
      .where(isNull(invoices.deletedAt))
      .orderBy(desc(invoices.createdAt))
      .limit(1);

    const match = /^(.*?)(\d+)(\D*)$/.exec(last?.number ?? "");
    if (!match) return { number: "INV-001" };
    const [, head, digits, tail] = match;
    let next = Number(digits);
    for (let tries = 0; tries < 100; tries++) {
      next += 1;
      const candidate = `${head}${String(next).padStart(digits.length, "0")}${tail}`;
      if (!(await this.numberTaken(this.db.client, candidate))) {
        return { number: candidate };
      }
    }
    return { number: "" };
  }

  async create(input: SaveInvoiceInput, actor: AuthenticatedUser) {
    const read = readInvoice(input.document);
    const created = await this.audit.mutate({
      action: "create",
      entityTable: "invoices",
      module: "invoices",
      summary: `${actor.fullName} saved invoice ${read.invoiceNumber}`,
      read: () => Promise.resolve(undefined),
      run: async (tx) => {
        await this.refuseTaken(tx, read.invoiceNumber);
        const [row] = await tx
          .insert(invoices)
          .values({
            ...read,
            document: input.document,
            createdBy: actor.id,
            updatedBy: actor.id,
          })
          .returning({ id: invoices.id });
        // What the audit row keeps: the facts, not the logo's megabyte.
        return { id: row.id, ...read };
      },
    });
    return this.get(created.id);
  }

  async update(id: string, input: SaveInvoiceInput, actor: AuthenticatedUser) {
    const existing = await this.get(id);
    const read = readInvoice(input.document);

    await this.audit.mutate({
      action: "update",
      entityTable: "invoices",
      entityId: id,
      module: "invoices",
      summary:
        existing.invoiceNumber === read.invoiceNumber
          ? `${actor.fullName} edited invoice ${read.invoiceNumber}`
          : `${actor.fullName} edited invoice ${existing.invoiceNumber}, now ${read.invoiceNumber}`,
      read: (tx) => this.snapshot(tx, id),
      run: async (tx) => {
        await this.refuseTaken(tx, read.invoiceNumber, id);
        await tx
          .update(invoices)
          .set({
            ...read,
            document: input.document,
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(and(eq(invoices.id, id), isNull(invoices.deletedAt)));
      },
    });
    return this.get(id);
  }

  /* ------------------------------------------------------------------ */

  /** The row as the audit log keeps it — the document without its logo. */
  private async snapshot(tx: DbTransaction, id: string) {
    const [row] = await tx
      .select({
        invoiceNumber: invoices.invoiceNumber,
        status: invoices.status,
        clientName: invoices.clientName,
        issuedOn: invoices.issuedOn,
        dueOn: invoices.dueOn,
        totalAmount: invoices.totalAmount,
        usdRate: invoices.usdRate,
        document: sql<unknown>`${invoices.document} - 'logo'`,
      })
      .from(invoices)
      .where(eq(invoices.id, id))
      .limit(1);
    return row;
  }

  private async numberTaken(
    client: DbService["client"] | DbTransaction,
    number: string,
    exceptId?: string,
  ): Promise<boolean> {
    const [hit] = await client
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          sql`lower(${invoices.invoiceNumber}) = lower(${number})`,
          isNull(invoices.deletedAt),
          exceptId ? ne(invoices.id, exceptId) : undefined,
        ),
      )
      .limit(1);
    return Boolean(hit);
  }

  /**
   * One live invoice per number. The index says so too; this says it in a
   * sentence rather than as the index's 500.
   */
  private async refuseTaken(
    tx: DbTransaction,
    number: string,
    exceptId?: string,
  ) {
    if (await this.numberTaken(tx, number, exceptId)) {
      throw new ConflictException({
        message: `${number} is already the number of another invoice. Give this one a different number.`,
        errors: { number: ["Already used by another invoice"] },
      });
    }
  }
}

import { Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";

import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ZodBody, ZodQuery } from "../../common/pipes/zod-validation.pipe";
import {
  listInvoicesQuerySchema,
  saveInvoiceSchema,
  type ListInvoicesQuery,
  type SaveInvoiceInput,
} from "./invoice-document";
import { InvoicesService } from "./invoices.service";

const uuidSchema = z.string().uuid("Not a valid id");

/**
 * Saved invoices.
 *
 * Every route on `transactions.write`, reading included — the permission the
 * Invoice Builder has been gated on since it arrived (#116): an invoice asks
 * for money on the company's behalf and prints its bank account, and the
 * owner kept it to the super admin and the CFO. A permission of its own would
 * be granted to exactly those two, and is a change to the role matrix that
 * would have to travel alone.
 *
 * No DELETE here: deleting goes through the trash (`DELETE /trash/invoice/
 * :id`), as every other row in the app does, so it can be undone.
 */
@Controller("invoices")
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermission("transactions.write")
  list(@ZodQuery(listInvoicesQuerySchema) query: ListInvoicesQuery) {
    return this.invoices.list(query);
  }

  /** Declared above `:id`, or Nest reads "next-number" as an id. */
  @Get("next-number")
  @RequirePermission("transactions.write")
  nextNumber() {
    return this.invoices.nextNumber();
  }

  @Get(":id")
  @RequirePermission("transactions.write")
  get(@Param("id") id: string) {
    return this.invoices.get(uuidSchema.parse(id));
  }

  @Post()
  @RequirePermission("transactions.write")
  create(
    @ZodBody(saveInvoiceSchema) body: SaveInvoiceInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.invoices.create(body, actor);
  }

  @Patch(":id")
  @RequirePermission("transactions.write")
  update(
    @Param("id") id: string,
    @ZodBody(saveInvoiceSchema) body: SaveInvoiceInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.invoices.update(uuidSchema.parse(id), body, actor);
  }
}

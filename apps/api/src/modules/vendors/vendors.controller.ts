import { Controller, Get, Param, Patch, Post } from "@nestjs/common";
import {
  createVendorSchema,
  listVendorsQuerySchema,
  updateVendorSchema,
  type CreateVendorInput,
  type ListVendorsQuery,
  type UpdateVendorInput,
} from "@finance/shared";
import { z } from "zod";

import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ZodBody, ZodQuery } from "../../common/pipes/zod-validation.pipe";
import { VendorsService } from "./vendors.service";

const uuidSchema = z.string().uuid("Not a valid id");
const searchQuerySchema = z.strictObject({
  q: z.string().trim().max(120).default(""),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

@Controller("vendors")
export class VendorsController {
  constructor(private readonly vendors: VendorsService) {}

  @Get()
  @RequirePermission("vendors.read")
  list(@ZodQuery(listVendorsQuerySchema) query: ListVendorsQuery) {
    return this.vendors.list(query);
  }

  /** Typeahead for the transaction form. */
  @Get("search")
  @RequirePermission("vendors.read")
  search(
    @ZodQuery(searchQuerySchema) query: z.infer<typeof searchQuerySchema>,
  ) {
    return this.vendors.search(query.q, query.limit);
  }

  /**
   * Everything that renews. Declared before `:id` or "subscriptions" would be
   * read as a vendor id and 400 on the uuid parse.
   */
  @Get("subscriptions")
  @RequirePermission("vendors.read")
  subscriptions() {
    return this.vendors.subscriptions();
  }

  @Get(":id")
  @RequirePermission("vendors.read")
  findOne(@Param("id") id: string) {
    return this.vendors.findOne(uuidSchema.parse(id));
  }

  @Post()
  @RequirePermission("vendors.write")
  create(
    @ZodBody(createVendorSchema) body: CreateVendorInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.vendors.create(body, actor);
  }

  @Patch(":id")
  @RequirePermission("vendors.write")
  update(
    @Param("id") id: string,
    @ZodBody(updateVendorSchema) body: UpdateVendorInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.vendors.update(uuidSchema.parse(id), body, actor);
  }
}

import { Controller, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import {
  createAccountSchema,
  listAccountsQuerySchema,
  updateAccountSchema,
  type CreateAccountInput,
  type ListAccountsQuery,
  type UpdateAccountInput,
} from "@finance/shared";
import { z } from "zod";

import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ZodBody, ZodQuery } from "../../common/pipes/zod-validation.pipe";
import { AccountsService } from "./accounts.service";

const uuidSchema = z.string().uuid("Not a valid id");

@Controller("accounts")
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @RequirePermission("accounts.read")
  list(@ZodQuery(listAccountsQuerySchema) query: ListAccountsQuery) {
    return this.accounts.list(query);
  }

  @Get("balances")
  @RequirePermission("dashboard.money")
  balances() {
    return this.accounts.balances();
  }

  @Get(":id")
  @RequirePermission("accounts.read")
  findOne(@Param("id") id: string) {
    return this.accounts.findOne(uuidSchema.parse(id));
  }

  @Post()
  @RequirePermission("accounts.write")
  create(
    @ZodBody(createAccountSchema) body: CreateAccountInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.accounts.create(body, actor);
  }

  @Patch(":id")
  @RequirePermission("accounts.write")
  update(
    @Param("id") id: string,
    @ZodBody(updateAccountSchema) body: UpdateAccountInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.accounts.update(uuidSchema.parse(id), body, actor);
  }

  @Post(":id/archive")
  @HttpCode(200)
  @RequirePermission("accounts.write")
  archive(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.accounts.archive(uuidSchema.parse(id), actor);
  }
}

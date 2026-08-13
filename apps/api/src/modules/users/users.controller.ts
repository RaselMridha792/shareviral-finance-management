import { Controller, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";

import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ZodBody, ZodQuery } from "../../common/pipes/zod-validation.pipe";
import {
  createUserSchema,
  listUsersQuerySchema,
  resetPasswordSchema,
  updateUserSchema,
  type CreateUserInput,
  type ListUsersQuery,
  type ResetPasswordInput,
  type UpdateUserInput,
} from "./users.schemas";
import { UsersService } from "./users.service";

const uuidSchema = z.string().uuid("Not a valid id");

/** Every route here is Super Admin only. */
@Controller("users")
@RequirePermission("users.manage")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@ZodQuery(listUsersQuerySchema) query: ListUsersQuery) {
    return this.users.list(query);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.users.findOne(uuidSchema.parse(id));
  }

  @Post()
  create(
    @ZodBody(createUserSchema) body: CreateUserInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.create(body, actor);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @ZodBody(updateUserSchema) body: UpdateUserInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.update(uuidSchema.parse(id), body, actor);
  }

  @Post(":id/reset-password")
  @HttpCode(200)
  resetPassword(
    @Param("id") id: string,
    @ZodBody(resetPasswordSchema) body: ResetPasswordInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.resetPassword(uuidSchema.parse(id), body, actor);
  }
}

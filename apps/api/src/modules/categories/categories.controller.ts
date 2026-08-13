import { Controller, Get, Param, Patch, Post } from "@nestjs/common";
import {
  createCategorySchema,
  listCategoriesQuerySchema,
  updateCategorySchema,
  type CreateCategoryInput,
  type ListCategoriesQuery,
  type UpdateCategoryInput,
} from "@finance/shared";
import { z } from "zod";

import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ZodBody, ZodQuery } from "../../common/pipes/zod-validation.pipe";
import { CategoriesService } from "./categories.service";

const uuidSchema = z.string().uuid("Not a valid id");

@Controller("categories")
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequirePermission("categories.read")
  list(@ZodQuery(listCategoriesQuerySchema) query: ListCategoriesQuery) {
    return this.categories.list(query);
  }

  /** Parents with their sub-categories nested — what the expenses screen uses. */
  @Get("tree")
  @RequirePermission("categories.read")
  tree(@ZodQuery(listCategoriesQuerySchema) query: ListCategoriesQuery) {
    return this.categories.tree(query);
  }

  @Get(":id")
  @RequirePermission("categories.read")
  findOne(@Param("id") id: string) {
    return this.categories.findOne(uuidSchema.parse(id));
  }

  @Post()
  @RequirePermission("categories.write")
  create(
    @ZodBody(createCategorySchema) body: CreateCategoryInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.categories.create(body, actor);
  }

  @Patch(":id")
  @RequirePermission("categories.write")
  update(
    @Param("id") id: string,
    @ZodBody(updateCategorySchema) body: UpdateCategoryInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.categories.update(uuidSchema.parse(id), body, actor);
  }
}

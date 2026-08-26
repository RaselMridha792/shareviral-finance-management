import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  slugify,
  type CreateCategoryInput,
  type ListCategoriesQuery,
  type UpdateCategoryInput,
} from "@finance/shared";
import { and, asc, eq, isNull, type SQL } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import { categories, type Category } from "../../db/schema";

export type CategoryDto = Omit<
  Category,
  "deletedAt" | "deletedBy" | "deleteReason" | "entityId"
>;
export type CategoryNode = CategoryDto & { children: CategoryDto[] };

@Injectable()
export class CategoriesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** Flat list, parents before their own children. */
  async list(query: ListCategoriesQuery): Promise<CategoryDto[]> {
    // Annotated because an empty literal infers never[].
    // A deleted heading is in the trash, not in any picker.
    const filters: SQL[] = [isNull(categories.deletedAt)];
    if (query.kind) filters.push(eq(categories.kind, query.kind));
    if (!query.includeInactive) filters.push(eq(categories.isActive, true));

    return this.db.client
      .select(projection)
      .from(categories)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(asc(categories.sortOrder), asc(categories.name));
  }

  /** The two-level tree the expenses screen renders. */
  async tree(query: ListCategoriesQuery): Promise<CategoryNode[]> {
    const rows = await this.list(query);
    const parents = rows.filter((row) => row.parentId === null);
    const byParent = new Map<string, CategoryDto[]>();

    for (const row of rows) {
      if (!row.parentId) continue;
      const bucket = byParent.get(row.parentId) ?? [];
      bucket.push(row);
      byParent.set(row.parentId, bucket);
    }

    return parents.map((parent) => ({
      ...parent,
      children: byParent.get(parent.id) ?? [],
    }));
  }

  async findOne(id: string): Promise<CategoryDto> {
    const [row] = await this.db.client
      .select(projection)
      .from(categories)
      .where(eq(categories.id, id))
      .limit(1);

    if (!row) throw new NotFoundException("No such category");
    return row;
  }

  async create(input: CreateCategoryInput, actor: AuthenticatedUser) {
    let parent: CategoryDto | null = null;

    if (input.parentId) {
      parent = await this.findOne(input.parentId);

      // One level only. Three dropdowns at the moment of recording a payment
      // reliably produces money filed under the wrong heading.
      if (parent.parentId) {
        throw new BadRequestException({
          message: "Validation failed",
          errors: {
            parentId: [
              `"${parent.name}" is already a sub-category — categories go two levels deep`,
            ],
          },
        });
      }

      // A sub-category that sits on the other side of the ledger from its
      // parent would make the parent's total meaningless.
      if (parent.kind !== input.kind && parent.kind !== "both") {
        throw new BadRequestException({
          message: "Validation failed",
          errors: {
            kind: [
              `"${parent.name}" is a ${parent.kind === "in" ? "money in" : "money out"} category, so its sub-categories must be too`,
            ],
          },
        });
      }
    }

    const slug = slugify(input.name);
    if (!slug) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: { name: ["Use at least one letter or number"] },
      });
    }
    await this.assertSlugFree(slug, input.parentId ?? null);

    return this.audit.mutate({
      action: "create",
      entityTable: "categories",
      summary: parent
        ? `Added sub-category "${input.name}" under "${parent.name}"`
        : `Added category "${input.name}"`,
      module: "categories",
      read: () => Promise.resolve(undefined),
      run: async (tx) => {
        const [row] = await tx
          .insert(categories)
          .values({
            name: input.name,
            slug,
            kind: input.kind,
            parentId: input.parentId ?? null,
            color: parent ? parent.color : input.color,
            sortOrder: input.sortOrder,
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
    input: UpdateCategoryInput,
    actor: AuthenticatedUser,
  ) {
    const existing = await this.findOne(id);

    let slug = existing.slug;
    if (input.name && input.name !== existing.name) {
      slug = slugify(input.name);
      if (!slug) {
        throw new BadRequestException({
          message: "Validation failed",
          errors: { name: ["Use at least one letter or number"] },
        });
      }
      await this.assertSlugFree(slug, existing.parentId, id);
    }

    // Deactivating a parent would leave its children reachable but orphaned in
    // the UI, so take them with it.
    const deactivating = input.isActive === false && existing.isActive;

    return this.audit.mutate({
      action: "update",
      entityTable: "categories",
      entityId: id,
      summary: describeUpdate(existing, input),
      module: "categories",
      read: async (tx) => {
        const [row] = await tx
          .select(projection)
          .from(categories)
          .where(eq(categories.id, id))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        const [row] = await tx
          .update(categories)
          .set({
            ...(input.name ? { name: input.name, slug } : {}),
            ...(input.color ? { color: input.color } : {}),
            ...(input.sortOrder !== undefined
              ? { sortOrder: input.sortOrder }
              : {}),
            ...(input.isActive !== undefined
              ? { isActive: input.isActive }
              : {}),
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(eq(categories.id, id))
          .returning(projection);

        if (deactivating && !existing.parentId) {
          await tx
            .update(categories)
            .set({
              isActive: false,
              updatedAt: new Date(),
              updatedBy: actor.id,
            })
            .where(eq(categories.parentId, id));
        }

        // Colour belongs to the parent so a donut slice and its breakdown match.
        if (input.color && !existing.parentId) {
          await tx
            .update(categories)
            .set({ color: input.color, updatedAt: new Date() })
            .where(eq(categories.parentId, id));
        }

        return row;
      },
    });
  }

  private async assertSlugFree(
    slug: string,
    parentId: string | null,
    exceptId?: string,
  ) {
    const [clash] = await this.db.client
      .select({ id: categories.id, deletedAt: categories.deletedAt })
      .from(categories)
      .where(
        and(
          eq(categories.slug, slug),
          parentId
            ? eq(categories.parentId, parentId)
            : isNull(categories.parentId),
        ),
      )
      .limit(1);

    if (clash && clash.id !== exceptId) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: {
          name: [
            // The slug is unique across live and trashed alike, so which of
            // the two is in the way decides what the reader should do next.
            clash.deletedAt
              ? "A deleted category still uses that name. Restore it from Settings → Trashed, or delete it there permanently, first."
              : parentId
                ? "That name is already used under this category"
                : "A category with that name already exists",
          ],
        },
      });
    }
  }
}

const projection = {
  id: categories.id,
  name: categories.name,
  slug: categories.slug,
  kind: categories.kind,
  parentId: categories.parentId,
  color: categories.color,
  sortOrder: categories.sortOrder,
  isSystem: categories.isSystem,
  isActive: categories.isActive,
  createdAt: categories.createdAt,
  updatedAt: categories.updatedAt,
  createdBy: categories.createdBy,
  updatedBy: categories.updatedBy,
};

function describeUpdate(
  existing: CategoryDto,
  input: UpdateCategoryInput,
): string {
  const parts: string[] = [];
  if (input.name && input.name !== existing.name) {
    parts.push(`renamed to "${input.name}"`);
  }
  if (input.color && input.color !== existing.color) {
    parts.push(`colour ${existing.color} → ${input.color}`);
  }
  if (input.isActive !== undefined && input.isActive !== existing.isActive) {
    parts.push(input.isActive ? "reactivated" : "deactivated");
  }
  const detail = parts.length ? parts.join(", ") : "details updated";
  return `Category "${existing.name}": ${detail}`;
}

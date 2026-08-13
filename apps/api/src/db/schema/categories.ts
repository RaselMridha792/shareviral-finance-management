import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { categoryKindEnum } from "./enums";
import { entityKey } from "./shared-columns";

/**
 * Two levels: a parent category and its sub-categories.
 *
 * Deliberately not three. Every extra level is another choice at the moment
 * someone records a payment, and the reliable result of three dropdowns is
 * money filed under the wrong heading.
 *
 * `/expenses/[slug]` and `/expenses/[slug]/[subSlug]` route on `slug`, so it is
 * unique among siblings rather than globally.
 */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id"),

    name: text("name").notNull(),
    slug: text("slug").notNull(),
    kind: categoryKindEnum("kind").notNull().default("out"),

    /** Null for a top-level category. One level of nesting only. */
    parentId: uuid("parent_id").references((): AnyPgColumn => categories.id, {
      onDelete: "restrict",
    }),

    /** Hex, drives the donut and the dot beside each row. */
    color: text("color").notNull().default("#4f46e5"),

    sortOrder: integer("sort_order").notNull().default(0),

    /**
     * Seeded rows are marked so the UI can warn before renaming something the
     * reports and imports refer to by name.
     */
    isSystem: boolean("is_system").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (t) => [
    // Unique among siblings: "Rent" may exist under both Office and Equipment.
    uniqueIndex("categories_slug_idx").on(
      entityKey(t.entityId),
      entityKey(t.parentId),
      t.slug,
    ),
    index("categories_parent_idx").on(t.parentId, t.sortOrder),
    index("categories_kind_idx").on(t.kind, t.isActive),
  ],
);

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: "category_parent",
  }),
  children: many(categories, { relationName: "category_parent" }),
}));

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;

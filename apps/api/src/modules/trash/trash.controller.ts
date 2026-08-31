import { Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { z } from "zod";

import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ZodBody, ZodQuery } from "../../common/pipes/zod-validation.pipe";

import { TrashService } from "./trash.service";

/*
 * The shapes are declared here rather than in `packages/shared` on purpose.
 *
 * That package is consumed as built `dist/`, and everything in it is read by
 * screens that have nothing to do with this one. The trash is a single screen
 * with a single caller; a schema it alone uses does not need to be a dependency
 * of twenty others.
 */
const idSchema = z.uuid("That is not an id this app would have issued");

const deleteBodySchema = z.object({
  /** Typed into the confirmation box. Optional, and shown in the trash. */
  reason: z.string().trim().max(500).nullish(),
});

const bulkBodySchema = z.object({
  /*
   * Capped at the same 200 the pager caps a page at. A tick column can only
   * select what is on the screen, so anything larger did not come from the
   * screen — and a request that could sweep a table wants a different
   * conversation than this one.
   */
  ids: z.array(idSchema).min(1, "Nothing was selected").max(200),
  reason: z.string().trim().max(500).nullish(),
});

const listQuerySchema = z.object({
  kind: z.string().trim().min(1).max(40).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

type DeleteBody = z.infer<typeof deleteBodySchema>;
type BulkBody = z.infer<typeof bulkBodySchema>;
type ListQuery = z.infer<typeof listQuerySchema>;

/**
 * One door for every kind of deletion.
 *
 * `settings.read` gates the listing rather than a permission of its own: the
 * trash lives in Settings, and the service then filters what it returns down to
 * the kinds this role could have deleted. So the screen opens for anybody who
 * can reach Settings, and shows each of them only their own reach.
 *
 * Acting on a row — deleting, restoring, purging — is checked against that
 * row's kind inside the service, which is the only place that knows a
 * transaction needs `transactions.write` and a category `categories.write`.
 */
@Controller("trash")
export class TrashController {
  constructor(private readonly trash: TrashService) {}

  /** The kinds this role may act on, and how many of each are waiting. */
  @Get("summary")
  @RequirePermission("settings.read")
  summary(@CurrentUser() actor: AuthenticatedUser) {
    return this.trash.summary(actor);
  }

  @Get()
  @RequirePermission("settings.read")
  list(
    @ZodQuery(listQuerySchema) query: ListQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.trash.list(actor, query);
  }

  /**
   * Moves a row to the trash.
   *
   * POST rather than DELETE because nothing is destroyed: the row is still
   * there, still readable by id, and still in the audit log. `DELETE` on this
   * same path is the one that really removes it.
   */
  /**
   * Restore, or purge, a ticked list.
   *
   * Both DECLARED ABOVE the single-id routes, for the reason the bulk delete
   * documents: Nest matches in declaration order, so below them "bulk-restore"
   * would arrive as an :id and be refused as not an id.
   */
  @Post(":kind/bulk-restore")
  @RequirePermission("settings.read")
  restoreMany(
    @Param("kind") kind: string,
    @ZodBody(bulkBodySchema) body: BulkBody,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.trash.restoreMany(kind, body.ids, actor);
  }

  @Post(":kind/bulk-purge")
  @RequirePermission("settings.read")
  purgeMany(
    @Param("kind") kind: string,
    @ZodBody(bulkBodySchema) body: BulkBody,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.trash.purgeMany(kind, body.ids, actor);
  }

  /**
   * The same act, on a ticked list.
   *
   * DECLARED ABOVE `:kind/:id`, and that is not tidiness. Nest matches routes
   * in declaration order, so below it "bulk" would arrive as `:id` and
   * `idSchema.parse` would answer "That is not an id this app would have
   * issued" — a confusing 400 for a route that exists.
   */
  @Post(":kind/bulk")
  @RequirePermission("settings.read")
  removeMany(
    @Param("kind") kind: string,
    @ZodBody(bulkBodySchema) body: BulkBody,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.trash.removeMany(
      kind,
      body.ids,
      body.reason?.trim() || null,
      actor,
    );
  }

  @Post(":kind/:id")
  @RequirePermission("settings.read")
  remove(
    @Param("kind") kind: string,
    @Param("id") id: string,
    @ZodBody(deleteBodySchema) body: DeleteBody,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.trash.remove(
      kind,
      idSchema.parse(id),
      body.reason?.trim() || null,
      actor,
    );
  }

  @Post(":kind/:id/restore")
  @RequirePermission("settings.read")
  restore(
    @Param("kind") kind: string,
    @Param("id") id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.trash.restore(kind, idSchema.parse(id), actor);
  }

  /** Gone. The audit row keeps what it said; the row itself does not exist. */
  @Delete(":kind/:id")
  @RequirePermission("settings.read")
  purge(
    @Param("kind") kind: string,
    @Param("id") id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.trash.purge(kind, idSchema.parse(id), actor);
  }

  /**
   * Empties the trash of everything this role could have put there.
   *
   * Not everything in it — see `TrashService.empty`. One person's tidying up
   * must not destroy another role's deleted transactions.
   */
  @Delete()
  @RequirePermission("settings.read")
  empty(@CurrentUser() actor: AuthenticatedUser) {
    return this.trash.empty(actor);
  }
}

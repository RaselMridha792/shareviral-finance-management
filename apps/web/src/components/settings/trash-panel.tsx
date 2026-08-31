"use client";

import { ArchiveRestore, LoaderCircle, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/patterns";
import {
  SerialCell,
  SerialHead,
  TableMessageRow,
  TableScroll,
  Th,
  TickCell,
  TickHead,
} from "@/components/ui/table";
import {
  ApiError,
  trashApi,
  type TrashItem,
  type TrashKindSummary,
} from "@/lib/api-client";
import { cn, formatDate } from "@/lib/utils";
import { useBulkSelect } from "@/components/ui/use-bulk-select";

/**
 * Where deleted rows wait.
 *
 * Everything any screen deletes lands here, whatever kind of row it was, in
 * one list newest first — because the person opening this tab is looking for
 * "the thing that disappeared on Tuesday", and should not need to know which
 * of fifteen kinds it was to find it.
 *
 * Two exits per row and no third: back to where it lived, or gone for good.
 * The second one goes through the same typed-word dialog that put the row
 * here, because it is the only act in this app with less mercy than the one
 * that did.
 *
 * What the listing shows is already filtered by the server to the kinds this
 * role could have deleted — HR sees people, not money — so an empty trash
 * here does not claim nobody deleted anything, only nothing you could act on.
 */
export function TrashPanel() {
  const [summary, setSummary] = useState<TrashKindSummary[] | null>(null);
  const [items, setItems] = useState<TrashItem[] | null>(null);
  /*
   * Ticking, keyed by kind AND id.
   *
   * This is the one table in the app whose rows are not all the same kind of
   * thing — a transaction, a person and an exchange rate can sit in it
   * together — and two kinds could in principle carry the same uuid. The
   * selection therefore keys on "kind:id", and the request is grouped by kind
   * on the way out, because the API's guards and permissions are per kind.
   */
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkAsking, setBulkAsking] = useState<null | "restore" | "purge">(
    null,
  );
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  /** A failed load is not an empty trash, and must not read as one. */
  const [loadError, setLoadError] = useState<string | null>(null);

  const [restoring, setRestoring] = useState<string | null>(null);
  const [purging, setPurging] = useState<TrashItem | null>(null);
  const [emptying, setEmptying] = useState(false);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(
    async (targetKind = kind, targetPage = page) => {
      try {
        const [kinds, listed] = await Promise.all([
          trashApi.summary(),
          trashApi.list({
            kind: targetKind ?? undefined,
            page: targetPage,
            pageSize: 20,
          }),
        ]);
        setLoadError(null);
        setSummary(kinds);
        setItems(listed.items);
        setTotal(listed.total);
        setPageSize(listed.pageSize);
      } catch (error) {
        setLoadError(
          error instanceof ApiError
            ? error.message
            : "The trash could not be read. Reload the page to try again.",
        );
      }
    },
    [kind, page],
  );

  useEffect(() => {
    /*
     * Reading on open is what an effect is for, and the panel has nothing to
     * show until it has. The same exemption the rate history and the users
     * panel take, for the same reason.
     */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const filter = (next: string | null) => {
    setKind(next);
    setPage(1);
  };

  const restore = async (item: TrashItem) => {
    setActionError(null);
    setRestoring(item.id);
    try {
      await trashApi.restore(item.kind, item.id);
      await load();
    } catch (error) {
      setActionError(
        error instanceof ApiError ? error.message : "Restoring failed.",
      );
    } finally {
      setRestoring(null);
    }
  };

  const purge = async () => {
    if (!purging) return;
    setPending(true);
    setActionError(null);
    try {
      await trashApi.purge(purging.kind, purging.id);
      setPurging(null);
      await load();
    } catch (error) {
      setActionError(
        error instanceof ApiError ? error.message : "That did not go through.",
      );
    } finally {
      setPending(false);
    }
  };

  const emptyAll = async () => {
    setPending(true);
    setActionError(null);
    try {
      await trashApi.empty();
      setEmptying(false);
      await load(kind, 1);
      setPage(1);
    } catch (error) {
      setActionError(
        error instanceof ApiError ? error.message : "That did not go through.",
      );
    } finally {
      setPending(false);
    }
  };

  const waiting = summary === null || items === null;
  const anythingAtAll = summary?.some((k) => k.count > 0) ?? false;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  /*
   * The hook wants rows with an `id`; the trash's identity is kind AND id, so
   * the two are joined for the selection and split again on the way out.
   */
  const tickable = (items ?? []).map((item) => ({
    id: `${item.kind}:${item.id}`,
  }));
  const bulk = useBulkSelect(tickable);

  return (
    <Card>
      <CardHeader
        title="Trashed"
        description="Deleted rows wait here. Restore puts one back exactly where it was; emptying the trash is the only delete in this app that cannot be undone."
        action={
          anythingAtAll ? (
            <Button
              variant="danger"
              size="sm"
              onClick={() => setEmptying(true)}
            >
              <Trash2 className="size-3.5" />
              Empty the trash
            </Button>
          ) : undefined
        }
      />

      {loadError ? (
        <p className="px-1 py-6 text-sm text-negative">{loadError}</p>
      ) : waiting ? (
        <div className="flex items-center gap-2 px-1 py-8 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Reading the trash…
        </div>
      ) : !anythingAtAll ? (
        <EmptyState icon="delete" title="The trash is empty">
          When a row is deleted anywhere in the app it comes here first, and can
          be put back until the trash is emptied.
        </EmptyState>
      ) : (
        <>
          {/*
            Two verbs, not one. Everything else in the app that ticks rows
            offers "Move to trash"; here the rows are already in it, so the
            pair is Restore and Delete for ever — and Restore comes first
            because it is the one somebody reaches for in a hurry.
          */}
          {bulk.count > 0 ? (
            <div
              role="status"
              className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2"
            >
              <p className="text-sm text-muted-foreground">
                <span className="num font-medium text-foreground">
                  {bulk.count}
                </span>{" "}
                {bulk.count === 1 ? "row" : "rows"} selected
              </p>
              <span className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={bulk.clear}
                  disabled={bulkPending}
                >
                  Clear
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setBulkError(null);
                    setBulkAsking("restore");
                  }}
                  disabled={bulkPending}
                >
                  Restore
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    setBulkError(null);
                    setBulkAsking("purge");
                  }}
                  disabled={bulkPending}
                >
                  Delete for ever
                </Button>
              </span>
            </div>
          ) : null}

          {/*
            One chip per kind, with its count. A filter, not navigation — the
            all-kinds list stays the default because "what disappeared" rarely
            arrives with a table name attached.
          */}
          <div className="flex flex-wrap gap-1.5 pb-3">
            <KindChip
              label="Everything"
              count={summary.reduce((n, k) => n + k.count, 0)}
              active={kind === null}
              onClick={() => filter(null)}
            />
            {summary
              .filter((k) => k.count > 0)
              .map((k) => (
                <KindChip
                  key={k.kind}
                  label={k.plural}
                  count={k.count}
                  active={kind === k.kind}
                  onClick={() => filter(k.kind)}
                />
              ))}
          </div>

          {actionError ? (
            <p className="pb-3 text-sm text-negative">{actionError}</p>
          ) : null}

          <TableScroll>
            <table className="table-data">
              <thead>
                <tr>
                  {bulk ? (
                    <TickHead
                      state={bulk.headerState}
                      onChange={bulk.allOnPage}
                    />
                  ) : null}
                  <SerialHead />
                  <Th>What</Th>
                  <Th>Deleted</Th>
                  <Th>By</Th>
                  <Th>Why</Th>
                  <Th width="w-44">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <TableMessageRow colSpan={bulk ? 7 : 6}>
                    Nothing of that kind is in the trash.
                  </TableMessageRow>
                ) : (
                  items.map((item, index) => (
                    <tr key={`${item.kind}:${item.id}`}>
                      {bulk ? (
                        <TickCell
                          checked={bulk.isTicked(`${item.kind}:${item.id}`)}
                          onChange={() =>
                            bulk.toggle(`${item.kind}:${item.id}`)
                          }
                          label={item.title ?? item.id}
                        />
                      ) : null}
                      <SerialCell n={(page - 1) * pageSize + index + 1} />
                      <td>
                        <div className="flex flex-col">
                          <span className="font-medium">{item.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {item.kindLabel}
                            {item.detail ? ` · ${item.detail}` : ""}
                            {item.occurredAt
                              ? ` · ${formatDate(item.occurredAt)}`
                              : ""}
                          </span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap">
                        {formatDate(item.deletedAt.slice(0, 10))}
                      </td>
                      <td>{item.deletedByName ?? "N/A"}</td>
                      <td className="max-w-56">
                        <span
                          className="block truncate text-muted-foreground"
                          title={item.deleteReason ?? undefined}
                        >
                          {item.deleteReason ?? "N/A"}
                        </span>
                      </td>
                      <td>
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={restoring === item.id}
                            onClick={() => void restore(item)}
                          >
                            {restoring === item.id ? (
                              <LoaderCircle className="size-3.5 animate-spin" />
                            ) : (
                              <ArchiveRestore className="size-3.5" />
                            )}
                            Restore
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Delete ${item.title} for ever`}
                            onClick={() => setPurging(item)}
                          >
                            <X className="size-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableScroll>

          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            noun="deleted row"
            onPage={(next) => setPage(next)}
            className="pt-3"
          />
        </>
      )}

      {/*
        Removing one row for ever. The same dialog that started its journey
        here — same checkbox, same typed word — because this step is the one
        with no way back at all.
      */}
      {/*
        The confirmation for a ticked list.
        `mode` decides the words: "trash" is recoverable and "delete" is not,
        and the ceremony differs accordingly — restoring asks far less of
        somebody than purging, because restoring can be undone by trashing
        again and purging cannot be undone at all.
      */}
      <DeleteDialog
        open={bulkAsking !== null}
        mode={bulkAsking === "purge" ? "delete" : "trash"}
        subject="row"
        count={bulk.count}
        title={
          bulkAsking === "purge"
            ? `Delete those ${bulk.count} for good?`
            : `Restore those ${bulk.count}?`
        }
        intro={
          bulkAsking === "purge"
            ? "They leave the trash and the database. Nothing brings them back."
            : "They go back where they were, and appear on their own screens again."
        }
        summary={
          <>
            {(items ?? [])
              .filter((i) => bulk.isTicked(`${i.kind}:${i.id}`))
              .slice(0, 6)
              .map((i) => i.title ?? i.id)
              .join(", ")}
            {bulk.count > 6 ? ` and ${bulk.count - 6} more` : ""}
          </>
        }
        askForReason={false}
        pending={bulkPending}
        error={bulkError}
        onCancel={() => setBulkAsking(null)}
        onConfirm={() => {
          const chosen = (items ?? []).filter((i) =>
            bulk.isTicked(`${i.kind}:${i.id}`),
          );
          /*
           * Grouped by kind, because the API's guards and permissions are per
           * kind — a batch spans one kind only. The trash is the one table
           * whose rows are not all the same sort of thing.
           */
          const byKind = new Map<string, string[]>();
          for (const item of chosen) {
            byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item.id]);
          }

          setBulkPending(true);
          setBulkError(null);
          const purging = bulkAsking === "purge";
          void Promise.all(
            [...byKind].map(([k, ids]) =>
              purging
                ? trashApi.purgeMany(k, ids)
                : trashApi.restoreMany(k, ids),
            ),
          )
            .then(async (answers) => {
              const failed = answers.flatMap((a) => a.failed);
              if (failed.length > 0) {
                /*
                 * Said, not swallowed. Unlike a delete, a partial answer here
                 * is not a trap — what did not move is still in the trash and
                 * can be tried again — but it must not read as complete.
                 */
                setBulkError(
                  `${failed.length} could not be ${purging ? "deleted" : "restored"}: ${failed[0]?.reason ?? ""}`,
                );
              } else {
                setBulkAsking(null);
              }
              bulk.clear();
              await load(kind, page);
            })
            .catch((err: unknown) =>
              setBulkError(
                err instanceof ApiError ? err.message : "That did not work.",
              ),
            )
            .finally(() => setBulkPending(false));
        }}
      />

      <DeleteDialog
        open={purging !== null}
        mode="delete"
        subject={purging?.kindLabel ?? "row"}
        summary={
          purging ? (
            <div className="flex flex-col">
              <span className="font-medium">{purging.title}</span>
              <span className="text-xs text-muted-foreground">
                {purging.kindLabel}
                {purging.detail ? ` · ${purging.detail}` : ""}
              </span>
            </div>
          ) : null
        }
        consequences={
          <p>
            This removes it from the trash{" "}
            <span className="font-medium text-foreground">permanently</span>.
            There is no restore after this — not from this screen, not from
            anywhere in the app.
          </p>
        }
        askForReason={false}
        pending={pending}
        error={actionError}
        onConfirm={() => void purge()}
        onCancel={() => setPurging(null)}
      />

      {/* Emptying everything at once: the same ceremony, in words that say so. */}
      <DeleteDialog
        open={emptying}
        mode="delete"
        title="Empty the trash for good?"
        subject="trash"
        summary={
          <div className="flex flex-col gap-0.5">
            {summary
              ?.filter((k) => k.count > 0)
              .map((k) => (
                <span key={k.kind}>
                  <span className="num font-medium">{k.count}</span>{" "}
                  {k.count === 1 ? k.label : k.plural.toLowerCase()}
                </span>
              ))}
          </div>
        }
        consequences={
          <p>
            Every row above is removed{" "}
            <span className="font-medium text-foreground">permanently</span>.
            Nothing in this app can bring them back afterwards.
          </p>
        }
        askForReason={false}
        pending={pending}
        error={actionError}
        onConfirm={() => void emptyAll()}
        onCancel={() => setEmptying(false)}
      />
    </Card>
  );
}

function KindChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition",
        active
          ? "border-primary bg-primary/10 text-primary-text"
          : "border-border text-muted-foreground hover:bg-surface-muted hover:text-foreground",
      )}
    >
      {label} <span className="num">{count}</span>
    </button>
  );
}

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
} from "@/components/ui/table";
import {
  ApiError,
  trashApi,
  type TrashItem,
  type TrashKindSummary,
} from "@/lib/api-client";
import { cn, formatDate } from "@/lib/utils";

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
                  <TableMessageRow colSpan={6}>
                    Nothing of that kind is in the trash.
                  </TableMessageRow>
                ) : (
                  items.map((item, index) => (
                    <tr key={`${item.kind}:${item.id}`}>
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

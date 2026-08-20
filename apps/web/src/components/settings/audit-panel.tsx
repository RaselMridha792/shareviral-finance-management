"use client";

import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  ROLE_LABELS,
  type AuditAction,
  type AuditEntryDto,
} from "@finance/shared";
import { ChevronDown, EyeOff, LoaderCircle } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DateRangeField,
  FilterBar,
  FilterSelect,
} from "@/components/ui/filters";
import { SearchField } from "@/components/ui/search-field";
import {
  SerialCell,
  SerialHead,
  TableMessageRow,
  TableScroll,
  Th,
} from "@/components/ui/table";
import { ApiError } from "@/lib/api-client";
import { auditApi, type AuditFilters } from "@/lib/audit";
import { serial } from "@/lib/pagination";
import { cn } from "@/lib/utils";

/** Actions that moved money, coloured so they stand out in a long list. */
const STRONG: AuditAction[] = ["void", "pay", "delete", "login_failed"];

export function AuditPanel() {
  const [filters, setFilters] = useState<AuditFilters>({});
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AuditEntryDto[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [options, setOptions] = useState<{
    modules: string[];
    actors: Array<{ id: string; fullName: string; role: string }>;
  }>({ modules: [], actors: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  // A bare setTimeout per keystroke fires a request per letter and lets a
  // slower earlier response land after a faster later one. This clears the
  // pending timer, so only the pause at the end of typing queries.
  useEffect(() => {
    const id = setTimeout(() => change({ q: search.trim() || undefined }), 300);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await auditApi.list(filters, page);
      setRows(result.items);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not load the trail.",
      );
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    void auditApi
      .filters()
      .then(setOptions)
      .catch(() => undefined);
  }, []);

  function change(next: Partial<AuditFilters>) {
    setFilters((current) => ({ ...current, ...next }));
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Every change to money, pay, tax and accounts, with who made it and what
        it was before. Written in the same database transaction as the change
        itself, so a change cannot exist without its record.
      </p>

      <Card className="p-3">
        <FilterBar>
          {/* No Search button: this list filters as you type. The clear cross
              is what was missing — the trail is long and there was no way back
              to all of it except selecting the text and deleting it.

              The one control here allowed to grow, because it is the only one
              whose content has no length limit. The minimum is the width below
              which the row gives up and wraps, not the width it usually gets. */}
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Search what happened…"
            label="Search the trail"
            className="min-w-32 flex-1"
          />

          {/* Content-sized, uncapped: the actions are written out in
              AUDIT_ACTIONS, so the widest label — "Settings changed" — is known
              here and cannot grow behind our backs. */}
          <FilterSelect
            label="Action"
            value={filters.action ?? ""}
            onChange={(next) =>
              change({ action: (next || undefined) as AuditAction })
            }
          >
            <option value="">Any action</option>
            {AUDIT_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {AUDIT_ACTION_LABELS[action]}
              </option>
            ))}
          </FilterSelect>

          {/* Capped: the areas are whatever the trail has recorded, so a long
              module name would otherwise size this control to itself and take
              the room out of the search box. */}
          <FilterSelect
            label="Area"
            wide
            value={filters.module ?? ""}
            onChange={(next) => change({ module: next || undefined })}
          >
            <option value="">Any area</option>
            {options.modules.map((module) => (
              <option key={module} value={module}>
                {module}
              </option>
            ))}
          </FilterSelect>

          {/* Capped for the same reason and more so: these are people's full
              names out of the users table. Past the cap the browser ellipsises
              the name, which is the right thing to lose — "Anyone" is what this
              reads for as long as nobody has been chosen. */}
          <FilterSelect
            label="Who"
            wide
            value={filters.actorUserId ?? ""}
            onChange={(next) => change({ actorUserId: next || undefined })}
          >
            <option value="">Anyone</option>
            {options.actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.fullName}
              </option>
            ))}
          </FilterSelect>

          {/* One bordered control rather than two boxes. Two boxes read as two
              unrelated dates; the hairline between them is what says they are
              the ends of one range, and the border and padding it saves are
              worth about thirty pixels to the search box.

              `change` is passed whole, so a date still resets to page one —
              narrowing the trail while standing on page four otherwise leaves
              you looking at a page that no longer exists. */}
          <DateRangeField
            from={filters.from}
            to={filters.to}
            onChange={change}
          />

          {Object.values(filters).some(Boolean) ? (
            <Button
              size="sm"
              variant="secondary"
              className="shrink-0"
              onClick={() => {
                // The search box too, not just the filters. Emptying
                // `filters.q` alone left the typed words on screen, and the
                // debounce then put the search straight back 300ms after it
                // was cleared.
                setSearch("");
                setFilters({});
                setPage(1);
              }}
            >
              Clear
            </Button>
          ) : null}
        </FilterBar>
      </Card>

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
        >
          {error}
        </p>
      ) : null}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="text-sm text-muted-foreground">
            {loading ? (
              <span className="flex items-center gap-2">
                <LoaderCircle className="size-3.5 animate-spin" />
                Loading…
              </span>
            ) : (
              `${total} record${total === 1 ? "" : "s"}`
            )}
          </span>
          {totalPages > 1 ? (
            <span className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Back
              </Button>
              <span className="num text-xs text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </span>
          ) : null}
        </div>

        <TableScroll>
          <table className="table-data min-w-[900px] text-sm">
            <thead>
              <tr className="text-left">
                <SerialHead />
                <Th width="w-44">When</Th>
                <Th width="w-52">Who</Th>
                <Th>What changed</Th>
                <Th width="w-40">Where</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading ? (
                <TableMessageRow colSpan={5}>
                  Nothing matches those filters.
                </TableMessageRow>
              ) : (
                rows.map((row, index) => {
                  const expanded = open === row.id;
                  const toggle = () => setOpen(expanded ? null : row.id);
                  const detailId = `audit-detail-${row.id}`;

                  return (
                    <Fragment key={row.id}>
                      <tr
                        className="row-finance cursor-pointer"
                        onClick={toggle}
                      >
                        <SerialCell n={serial(page, index)} />
                        <td className="num">{formatWhen(row.occurredAt)}</td>

                        <td>
                          {/*
                            The IP sits with the person, not under Where: it
                            says where the actor was, and Where answers where
                            in the books the change landed. Two different
                            questions that read as one if they share a column.
                          */}
                          <span className="block">
                            {row.actorName ?? "the system"}
                          </span>
                          {row.actorRole || row.actorIp ? (
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {row.actorRole ? ROLE_LABELS[row.actorRole] : ""}
                              {row.actorRole && row.actorIp ? " · " : ""}
                              {row.actorIp ? (
                                <span className="num">{row.actorIp}</span>
                              ) : null}
                            </span>
                          ) : null}
                        </td>

                        <td className="cell-prose">
                          {/*
                            The chevron rides with the summary rather than in a
                            column of its own. An audit record takes no actions
                            — a sixth column at the end of the row is the shape
                            of one, whatever we put in it.
                          */}
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-controls={detailId}
                            onClick={(event) => {
                              // The row toggles as well, so a press here would
                              // otherwise reach both handlers and the panel
                              // would open and shut inside one click.
                              event.stopPropagation();
                              toggle();
                            }}
                            className="flex w-full items-start gap-2 text-left"
                          >
                            <Badge
                              tone={
                                STRONG.includes(row.action)
                                  ? "negative"
                                  : row.action === "create"
                                    ? "positive"
                                    : "neutral"
                              }
                            >
                              {AUDIT_ACTION_LABELS[row.action]}
                            </Badge>

                            <span className="min-w-0 flex-1">
                              {row.summary}
                            </span>

                            {row.redacted ? (
                              <span
                                className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
                                title="This change involved pay. Your role can see that it happened, not what changed."
                              >
                                <EyeOff className="size-3.5" />
                                hidden
                              </span>
                            ) : null}

                            <ChevronDown
                              className={cn(
                                "size-4 shrink-0 text-muted-foreground transition",
                                expanded && "rotate-180",
                              )}
                            />
                          </button>
                        </td>

                        <td>
                          {/*
                            The Area filter above narrows on `module`, and until
                            now the list never showed it — you could filter by
                            something the table did not display. The table
                            underneath is the concrete one that changed.

                            `entityId` is not linked: it names a row in whatever
                            table this was, not an account or a person, so there
                            is no route to send it to.
                          */}
                          <span className="block">
                            {row.module ?? row.entityTable}
                          </span>
                          {row.module ? (
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {row.entityTable}
                            </span>
                          ) : null}
                        </td>
                      </tr>

                      {expanded ? (
                        <tr id={detailId}>
                          {/*
                            Five columns, matching the head above. The padding
                            has to be inline: `.table-data tbody td` is a class
                            plus two elements, so a `p-0` utility loses to it
                            and the panel would sit inset inside a cell that
                            already pads it.
                          */}
                          <td colSpan={5} style={{ padding: 0 }}>
                            <Detail row={row} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </TableScroll>
      </Card>
    </div>
  );
}

function Detail({ row }: { row: AuditEntryDto }) {
  if (row.redacted) {
    return (
      <div className="bg-surface-muted/30 px-4 py-4 text-sm text-muted-foreground">
        This change involved someone&apos;s pay. Your role can see that it
        happened and who did it, but not the figures.
      </div>
    );
  }

  const before = row.before as Record<string, unknown> | null;
  const after = row.after as Record<string, unknown> | null;
  const fields = row.changedFields?.length
    ? row.changedFields
    : Array.from(
        new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]),
      );

  if (!fields.length) {
    return (
      <div className="bg-surface-muted/30 px-4 py-4 text-sm text-muted-foreground">
        No field-level detail was recorded for this one.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto bg-surface-muted/30 px-4 py-3">
      <table className="table-data min-w-[520px] text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1.5 pr-4 font-medium">Field</th>
            <th className="py-1.5 pr-4 font-medium">Was</th>
            <th className="py-1.5 font-medium">Became</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field}>
              <td className="py-1.5 pr-4 font-medium">{field}</td>
              <td className="num py-1.5 pr-4 text-muted-foreground">
                {show(before?.[field])}
              </td>
              <td className="num py-1.5">{show(after?.[field])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">
        {row.entityTable}
        {row.entityId ? ` · ${row.entityId}` : ""}
      </p>
    </div>
  );
}

function show(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** "13 Aug 2026, 3:21 am" — in Dhaka, which is where the work happened. */
function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

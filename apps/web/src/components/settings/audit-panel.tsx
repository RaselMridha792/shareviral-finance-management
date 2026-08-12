"use client";

import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  ROLE_LABELS,
  type AuditAction,
  type AuditEntryDto,
} from "@finance/shared";
import { ChevronDown, EyeOff, LoaderCircle, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DateInput, Input, Select } from "@/components/ui/field";
import { ApiError } from "@/lib/api-client";
import { auditApi, type AuditFilters } from "@/lib/audit";
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
    const id = setTimeout(
      () => change({ q: search.trim() || undefined }),
      300,
    );
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
     
    void auditApi.filters().then(setOptions).catch(() => undefined);
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

      <Card className="flex flex-wrap items-end gap-2 p-3">
        <label className="flex flex-1 items-center gap-2">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            placeholder="Search what happened…"
            className="h-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>

        <Select
          aria-label="Action"
          className="h-9 w-40"
          value={filters.action ?? ""}
          onChange={(e) =>
            change({ action: (e.target.value || undefined) as AuditAction })
          }
        >
          <option value="">Any action</option>
          {AUDIT_ACTIONS.map((action) => (
            <option key={action} value={action}>
              {AUDIT_ACTION_LABELS[action]}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Area"
          className="h-9 w-36"
          value={filters.module ?? ""}
          onChange={(e) => change({ module: e.target.value || undefined })}
        >
          <option value="">Any area</option>
          {options.modules.map((module) => (
            <option key={module} value={module}>
              {module}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Who"
          className="h-9 w-44"
          value={filters.actorUserId ?? ""}
          onChange={(e) => change({ actorUserId: e.target.value || undefined })}
        >
          <option value="">Anyone</option>
          {options.actors.map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actor.fullName}
            </option>
          ))}
        </Select>

        <DateInput
          aria-label="From"
          className="h-9 w-36"
          value={filters.from ?? ""}
          onChange={(e) => change({ from: e.target.value || undefined })}
        />
        <DateInput
          aria-label="To"
          className="h-9 w-36"
          value={filters.to ?? ""}
          onChange={(e) => change({ to: e.target.value || undefined })}
        />

        {Object.values(filters).some(Boolean) ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setFilters({});
              setPage(1);
            }}
          >
            Clear
          </Button>
        ) : null}
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

        <ul className="divide-y divide-border">
          {rows.length === 0 && !loading ? (
            <li className="px-4 py-10 text-center text-sm text-muted-foreground">
              Nothing matches those filters.
            </li>
          ) : (
            rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => setOpen(open === row.id ? null : row.id)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-surface-muted/50"
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
                    <span className="block text-sm">{row.summary}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {row.actorName ?? "the system"}
                      {row.actorRole ? ` · ${ROLE_LABELS[row.actorRole]}` : ""}
                      {" · "}
                      <span className="num">
                        {formatWhen(row.occurredAt)}
                      </span>
                      {row.actorIp ? ` · ${row.actorIp}` : ""}
                    </span>
                  </span>

                  {row.redacted ? (
                    <span
                      className="flex items-center gap-1 text-xs text-muted-foreground"
                      title="This change involved pay. Your role can see that it happened, not what changed."
                    >
                      <EyeOff className="size-3.5" />
                      hidden
                    </span>
                  ) : null}

                  <ChevronDown
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground transition",
                      open === row.id && "rotate-180",
                    )}
                  />
                </button>

                {open === row.id ? <Detail row={row} /> : null}
              </li>
            ))
          )}
        </ul>
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
  const fields =
    row.changedFields?.length
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
        <tbody className="divide-y divide-border/60">
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

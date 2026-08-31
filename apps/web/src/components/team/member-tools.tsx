"use client";

import {
  SUBSCRIPTION_STATUS_TABS,
  SUBSCRIPTION_STATUS_LABELS,
  type SubscriptionStatus,
} from "@finance/shared";
import { ExternalLink, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  SubscriptionBodyCells,
  SubscriptionHeadCells,
} from "@/components/subscriptions/subscription-columns";
import { Pagination } from "@/components/ui/pagination";
import { SerialCell, SerialHead, TableScroll, Th } from "@/components/ui/table";
import { PAGE_SIZE, pageCount, serial } from "@/lib/pagination";
import {
  subscriptionsApi,
  type MemberSubscriptionDto,
} from "@/lib/subscriptions";
import { formatDate, cn } from "@/lib/utils";

/**
 * Every paid tool this person is on, or has ever been on.
 *
 * The status here is the plan's. A seat is a person and nothing else — the
 * date and the status are given once, when the tool is bought, and they cover
 * everybody on it. So a seat carries no status of its own to filter on, and
 * reading the one it was created with would drop every row into whichever
 * default it happened to get and leave three of these tabs permanently empty.
 *
 * Five tabs, and the fifth is not a status — "All" is the absence of the
 * filter rather than a value of it.
 */
export function MemberTools({
  memberId,
  numberFormat,
}: {
  memberId: string;
  numberFormat: "bangladeshi" | "western";
}) {
  const [rows, setRows] = useState<MemberSubscriptionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<SubscriptionStatus | "all">("active");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let live = true;
    subscriptionsApi
      .forMember(memberId)
      .then((next) => {
        if (live) setRows(next);
      })
      .catch(() => {
        if (live) setError("Could not read the tools for this person.");
      });
    return () => {
      live = false;
    };
  }, [memberId]);

  // Filtered here rather than refetched: this is a dozen rows for one person,
  // and a request per tab would make switching between them slower than
  // reading them.
  const shown = useMemo(
    () => (rows ?? []).filter((row) => tab === "all" || row.status === tab),
    [rows, tab],
  );

  // Counted from everything, not from the tab — a tab reading "Active" with
  // nothing under it should still say how many there are elsewhere. Counted the
  // same way it is filtered, or a tab promises rows it cannot then show.
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows ?? []) {
      map.set(row.status, (map.get(row.status) ?? 0) + 1);
    }
    return map;
  }, [rows]);

  // Twenty a page, like every other table here. A profile rarely has twenty
  // tools on it, which is exactly why this is worth having rather than not:
  // the one person who does is the one whose list would otherwise run off the
  // bottom of a card with nothing saying there is more.
  const totalPages = pageCount(shown.length);
  const visible = useMemo(
    () => shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [shown, page],
  );

  // Seats written before a seat became just a person still carry their own
  // dates, and those are a real record of who had what when. Nothing writes
  // them any more, so the column earns its width only while such rows exist —
  // asked of every row rather than the tab's, so the table does not change
  // shape underneath somebody switching tabs.
  const hasOwnDates = useMemo(
    () => (rows ?? []).some((row) => row.fromDate || row.untilDate),
    [rows],
  );

  if (error) {
    return (
      <p className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative">
        {error}
      </p>
    );
  }

  if (!rows) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        Looking…
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        Not on any paid tool. Seats are added from the subscription itself —{" "}
        <Link
          href="/subscriptions"
          className="text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
        >
          AI tools and subscriptions
        </Link>
        .
      </p>
    );
  }

  return (
    // `min-w-0` for the same reason the card outside has it: a flex column's
    // items are `min-width: auto` too, and one wide table is enough to carry
    // the overflow all the way up to the document.
    <div className="flex min-w-0 flex-col gap-3">
      <div
        role="tablist"
        aria-label="Tool status for this person"
        className="tabs-scroll flex gap-1 border-b border-border"
      >
        {SUBSCRIPTION_STATUS_TABS.map((entry) => {
          const count =
            entry.id === "all" ? rows.length : (counts.get(entry.id) ?? 0);
          return (
            <button
              key={entry.id}
              role="tab"
              type="button"
              aria-selected={tab === entry.id}
              onClick={() => {
                setTab(entry.id);
                // A reader on page two of Active who switches to Paused is
                // asking for Paused, not for its second page — which is often
                // empty, and reads as "there are none".
                setPage(1);
              }}
              className={cn(
                "-mb-px cursor-pointer border-b-2 px-3 py-2 text-sm font-medium transition",
                tab === entry.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {entry.label}
              <span className="num ml-1.5 text-xs opacity-60">{count}</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          Nothing{" "}
          {SUBSCRIPTION_STATUS_TABS.find(
            (t) => t.id === tab,
          )?.label.toLowerCase()}{" "}
          for this person.
        </p>
      ) : (
        <TableScroll>
          {/*
            The same fourteen columns the subscriptions screen shows, from the
            same component — the owner asked for the whole row here, and four
            of the fourteen was what a table with its own private query could
            offer. Then this screen's own two: the seat's dates where a row
            still has them, and the person's own access, which is the one thing
            on this table that is about them rather than about the plan.
          */}
          <table className="table-data w-full min-w-[2200px]">
            <thead>
              <tr>
                <SerialHead />
                <SubscriptionHeadCells />
                {hasOwnDates ? <Th>Their own dates</Th> : null}
                <Th>Their access</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {visible.map((row, index) => (
                <tr key={row.id} className="row-finance">
                  <SerialCell n={serial(page, index)} />
                  {/*
                    No handlers, and that is the point of them being optional:
                    this screen has no documents dialog and no screenshot
                    viewer, so the invoice and the transaction number render as
                    the numbers they are rather than as links that open
                    nothing.
                  */}
                  <SubscriptionBodyCells
                    row={row}
                    numberFormat={numberFormat}
                  />
                  {hasOwnDates ? (
                    <td>
                      <OwnDates
                        from={formatDate(row.fromDate)}
                        until={formatDate(row.untilDate)}
                      />
                    </td>
                  ) : null}
                  <td>
                    <AccessPill status={row.seatStatus} />
                  </td>
                  <td className="text-right">
                    <Link
                      href="/subscriptions"
                      className="inline-flex items-center gap-1 text-xs text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
                    >
                      Open
                      <ExternalLink className="size-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        total={shown.length}
        noun="tool"
        onPage={setPage}
      />

      <p className="text-xs text-muted-foreground">
        The cost shown is the whole plan&apos;s, not this person&apos;s share —
        a thirteen-seat plan costs what it costs however many people are on it.
      </p>

      {hasOwnDates ? (
        <p className="text-xs text-muted-foreground">
          Access runs with the plan, whose own dates are on the tool. The dates
          above are older per-person records, kept as they were written.
        </p>
      ) : null}
    </div>
  );
}

/**
 * A window somebody was given back when a seat had dates of its own.
 *
 * Rendered as one range rather than two columns because it is history, not
 * something being kept up to date — and a half of it can be missing, which two
 * columns of em-dashes read as "we lost this" rather than "it was never
 * written". Filling the missing half from the plan's own start and renewal
 * would be worse now that both are columns on this same row: the reader would
 * be shown the plan's date in a column headed "their own", with nothing saying
 * which of the two it was.
 */
function OwnDates({
  from,
  until,
}: {
  from: string | null;
  until: string | null;
}) {
  if (!from && !until)
    return <span className="text-muted-foreground">N/A</span>;
  return (
    <span className="inline-flex items-baseline gap-1.5">
      {from ? (
        <span className="num">{from}</span>
      ) : (
        <span className="text-muted-foreground">N/A</span>
      )}
      <span aria-hidden className="text-muted-foreground">
        →
      </span>
      <span className="sr-only">to</span>
      {until ? (
        <span className="num">{until}</span>
      ) : (
        <span className="text-muted-foreground">N/A</span>
      )}
    </span>
  );
}

function AccessPill({ status }: { status: SubscriptionStatus }) {
  const tone: Record<SubscriptionStatus, string> = {
    active: "bg-positive/10 text-positive",
    paused: "bg-warning/10 text-warning",
    canceled: "bg-negative/10 text-negative",
    expired: "bg-surface-muted text-muted-foreground",
  };
  return (
    <span
      title="This person's access, which can end while the plan runs on"
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
        tone[status],
      )}
    >
      {SUBSCRIPTION_STATUS_LABELS[status]}
    </span>
  );
}

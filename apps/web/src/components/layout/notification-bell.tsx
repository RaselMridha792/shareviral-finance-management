"use client";

import { Bell, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  notificationsApi,
  type NotificationRow,
} from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * The bell.
 *
 * It answers one question — is there anything I have not seen — and the badge
 * is the whole answer. Everything else on this control exists so that opening
 * it is worth doing: what happened, when, and a way to the screen it happened
 * on.
 *
 * Nothing here polls hard. These are notifications about dates arriving, not
 * about another person typing, so the useful resolution is minutes rather than
 * seconds; a five-minute refresh and a refresh when the tab comes back into
 * focus covers everything a renewal three days out can need.
 */

const REFRESH_MS = 5 * 60 * 1000;

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<NotificationRow[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const holder = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const result = await notificationsApi.list();
      setRows(result.items);
      setUnread(result.unread);
      setError(null);
    } catch {
      // Not an empty bell. A request that did not answer says nothing about
      // whether there is anything to see, and a badge that quietly drops to
      // zero on a failed fetch is worse than one that admits it.
      setError("Could not read your notifications.");
    }
  }, []);

  useEffect(() => {
    // The first read has to happen on mount: the badge is the only thing on
    // screen that says there is anything to open, so nothing else would ever
    // ask for it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);

    // The tab coming back is the moment somebody is about to look at this.
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  // Click outside and Escape both close it. A panel that can only be dismissed
  // by pressing the button again is one people leave open.
  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent) => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markOne(row: NotificationRow) {
    if (row.readAt) return;
    // Marked here first so the badge answers immediately; the request follows.
    // A bell that takes a round trip to stop shouting gets clicked twice.
    setRows((current) =>
      (current ?? []).map((item) =>
        item.id === row.id
          ? { ...item, readAt: new Date().toISOString() }
          : item,
      ),
    );
    setUnread((count) => Math.max(0, count - 1));
    await notificationsApi.read(row.id).catch(() => void load());
  }

  async function markAll() {
    setRows((current) =>
      (current ?? []).map((item) =>
        item.readAt ? item : { ...item, readAt: new Date().toISOString() },
      ),
    );
    setUnread(0);
    await notificationsApi.readAll().catch(() => void load());
  }

  return (
    <div ref={holder} className="relative">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-label={
          unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
        }
        aria-expanded={open}
        className="relative cursor-pointer rounded-md border border-border bg-surface-muted p-1.5 text-muted-foreground transition hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Bell className="size-4" />
        {unread > 0 ? (
          <span
            className="num absolute -top-1.5 -right-1.5 min-w-[1.15rem] rounded-full bg-negative px-1 text-[10px] leading-[1.15rem] font-semibold text-white"
            // Nine and a bit: the exact number stops mattering long before it
            // stops fitting, and a three-digit badge changes the header's shape.
          >
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-surface shadow-e2">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-medium">Notifications</span>
            {unread > 0 ? (
              <button
                type="button"
                onClick={() => void markAll()}
                className="cursor-pointer text-xs text-primary hover:underline"
              >
                Mark all read
              </button>
            ) : null}
          </div>

          <div className="max-h-[26rem] overflow-y-auto">
            {error ? (
              <p className="px-3 py-6 text-center text-sm text-negative">
                {error}
              </p>
            ) : !rows ? (
              <p className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                Loading…
              </p>
            ) : rows.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Nothing yet. Renewals, tax deadlines and unpaid payroll appear
                here.
              </p>
            ) : (
              rows.map((row) => (
                <NotificationItem
                  key={row.id}
                  row={row}
                  onOpen={() => {
                    void markOne(row);
                    setOpen(false);
                  }}
                />
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One line of the panel.
 *
 * A link when the notification has somewhere to send you and a plain block
 * when it does not — rather than a link that goes nowhere, which is the thing
 * that teaches people the panel is decorative.
 */
function NotificationItem({
  row,
  onOpen,
}: {
  row: NotificationRow;
  onOpen: () => void;
}) {
  const body = (
    <>
      <span className="flex items-start gap-2">
        {/* The unread mark is a dot rather than a background wash: a panel
            where most rows are tinted reads as an error state. */}
        <span
          className={cn(
            "mt-1.5 size-1.5 shrink-0 rounded-full",
            row.readAt ? "bg-transparent" : "bg-primary",
          )}
        />
        <span className="min-w-0">
          <span
            className={cn(
              "block text-sm",
              row.readAt ? "text-muted-foreground" : "font-medium",
            )}
          >
            {row.title}
          </span>
          {row.body ? (
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {row.body}
            </span>
          ) : null}
          <span className="num mt-1 block text-[11px] text-faint">
            {row.createdAt.slice(0, 16).replace("T", " ")}
          </span>
        </span>
      </span>
    </>
  );

  const className =
    "block w-full border-b border-border px-3 py-2.5 text-left transition last:border-b-0 hover:bg-surface-muted";

  return row.href ? (
    <Link href={row.href} onClick={onOpen} className={cn(className, "cursor-pointer")}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onOpen} className={cn(className, "cursor-pointer")}>
      {body}
    </button>
  );
}

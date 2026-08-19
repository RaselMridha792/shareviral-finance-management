import { cn } from "@/lib/utils";

/**
 * The shapes a page wears while its figures are still on the way.
 *
 * These exist because until now there were none, and the effect was worse than
 * it sounds. Every screen in this application is `force-dynamic` — the figures
 * are fetched on the server for each request — and a dynamic route with no
 * `loading` boundary cannot be prefetched into anything useful. So a click on
 * the sidebar did nothing at all, visibly, until the whole page had been
 * rendered and shipped. On a one-vCPU box that is long enough to click again.
 *
 * Adding these buys two things, and the second is the larger one:
 *
 *  1. Something happens the instant a link is clicked.
 *  2. Prefetch starts working. Next can fetch and hold this shell ahead of
 *     time, which it could not do while there was no boundary to stop at.
 *
 * They are deliberately dull. A skeleton is a placeholder for a layout, not a
 * light show: it should say "this is a table, wait" and then get out of the
 * way. Anything livelier draws the eye to the loading rather than the page.
 */

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      // Not aria-hidden. A screen reader should learn that something is
      // coming; the busy region below is what announces it.
      className={cn("animate-pulse rounded-md bg-surface-muted", className)}
      {...props}
    />
  );
}

/**
 * Wraps a whole skeleton screen.
 *
 * `aria-busy` with a polite live region, so the wait is announced once rather
 * than as a stream of appearing boxes.
 */
export function SkeletonScreen({ children }: { children: React.ReactNode }) {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Loading…</span>
      {children}
    </div>
  );
}

/** Title and subtitle, matching PageHeader's real proportions. */
export function SkeletonHeader({ actions = 1 }: { actions?: number }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-2 h-4 w-72 max-w-full" />
      </div>
      {actions > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {Array.from({ length: actions }, (_, i) => (
            <Skeleton key={i} className="h-9 w-28" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A table.
 *
 * The last column is right-aligned and narrower, because in this application
 * the last column is nearly always money, and a skeleton whose columns sit
 * where the real ones will not is a layout that jumps when the data lands.
 */
export function SkeletonTable({ rows = 8 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center gap-4 border-b border-border bg-surface-muted/50 px-4 py-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-32" />
        <Skeleton className="ml-auto h-3 w-20" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-b-0"
        >
          <Skeleton className="size-8 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3.5 w-40 max-w-full" />
            <Skeleton className="mt-1.5 h-3 w-24" />
          </div>
          <Skeleton className="h-4 w-24 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** A row of figure cards, as the dashboard and the account screens use. */
export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div
      className="grid gap-4"
      style={{
        gridTemplateColumns: "repeat(auto-fit, minmax(310px, 1fr))",
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl border border-border p-5">
          <div className="flex items-start gap-3">
            <Skeleton className="size-10 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3.5 w-32 max-w-full" />
              <Skeleton className="mt-1.5 h-3 w-24" />
            </div>
          </div>
          <Skeleton className="mt-5 h-7 w-36" />
          <Skeleton className="mt-2 h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

/** Tabs, for the screens that open on one. */
export function SkeletonTabs({ count = 4 }: { count?: number }) {
  return (
    <div className="flex gap-1 border-b border-border">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="mb-1 h-7 w-36" />
      ))}
    </div>
  );
}

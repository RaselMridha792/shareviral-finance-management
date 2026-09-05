"use client";

import { Plus } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";

import { useCan } from "@/components/auth/session-provider";
import { NewCategoryDrawer } from "@/components/ledger/category-select";
import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import type { ExpenseGroup } from "@/lib/ledger";
import type { CategoryNode } from "@/lib/masters";

/**
 * Which heading cards the Expenses page shows, and a way to make a new one.
 *
 * Two things behind one button, because the owner asked for both and they are
 * genuinely different weights — which is the thing this drawer has to make
 * visible. Ticking a card on is a preference, on this screen, for this person,
 * undone by ticking it off. Creating a heading changes the company's books: it
 * appears in every expense form, on every other expense screen, and in
 * Settings → Categories, and it is not undone from here.
 *
 * So the ticks are the body of the drawer and creating is a separate step at
 * the foot of it, behind its own drawer — not a third checkbox that happens to
 * be permanent.
 *
 * The list is every expense heading in the books, not only the ones with spend
 * this month. It used to be the latter, which meant the drawer could only swap
 * between the cards already on screen: a heading with nothing against it yet
 * had no row to tick, and one created here appeared nowhere until its first
 * bill was recorded. Tick as many as you like.
 */

/** One card's worth: a heading, and what the period put against it. */
export type Heading = ExpenseGroup & {
  /** Whether anything was actually spent under it in this period. */
  hasSpend: boolean;
};

/**
 * Every heading worth offering, with the period's figures filled in.
 *
 * The two sources are the summary — headings money went to, in the order it
 * went — and the category tree, which knows the ones it did not. A summary
 * group with no matching category (an entry filed under nothing, which the API
 * calls "Uncategorised") still belongs on the list; it simply is not in the
 * tree and cannot be created there.
 */
export function headingsFor(
  groups: ExpenseGroup[],
  categories: CategoryNode[],
): Heading[] {
  const spent = new Map(groups.map((g) => [g.id, g]));

  const quiet = categories
    .filter((c) => c.kind === "out" && c.isActive && !spent.has(c.id))
    .map<Heading>((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      color: c.color,
      total: "0.00",
      entries: 0,
      hasSpend: false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Spend first and biggest first — the summary already sorts that way — then
  // the quiet ones by name.
  return [...groups.map((g) => ({ ...g, hasSpend: true })), ...quiet];
}

/** Remembered per browser, like the dashboard card choice. */
const KEY = "svf-expense-headings";

/**
 * The two answers a tick can give, kept apart on purpose.
 *
 * A heading with spend is a card by default, so turning it off has to be
 * recorded. One without spend is not a card by default, so turning it *on* has
 * to be recorded too. A single list cannot say both — which is why the first
 * version of this, a bare array of hidden ids, could never add anything.
 */
type Choice = { on: string[]; off: string[] };

const NOTHING: Choice = { on: [], off: [] };

let choice: Choice = NOTHING;
let read = false;
const listeners = new Set<() => void>();

function snapshot(): Choice {
  return choice;
}

function parse(raw: string): Choice {
  const value: unknown = JSON.parse(raw);
  // What the first version wrote: a bare array of the ids being hidden.
  if (Array.isArray(value)) return { on: [], off: value as string[] };
  const record = value as Partial<Choice> | null;
  return {
    on: Array.isArray(record?.on) ? record.on : [],
    off: Array.isArray(record?.off) ? record.off : [],
  };
}

function subscribe(listener: () => void) {
  if (!read) {
    read = true;
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) choice = parse(raw);
    } catch {
      // Private browsing, or something that is not JSON any more. The
      // defaults — every heading with spend, and nothing else — are the safe
      // way to be wrong.
    }
    if (choice !== NOTHING) {
      queueMicrotask(() => listeners.forEach((l) => l()));
    }
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setChoice(next: Choice) {
  choice = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // As above. The choice holds for this visit and is not remembered.
  }
  listeners.forEach((listener) => listener());
}

/** What the reader has turned on and off. Empty on the server. */
export function useHeadingChoice(): Choice {
  return useSyncExternalStore(subscribe, snapshot, () => NOTHING);
}

/**
 * Is this heading a card right now?
 *
 * Spend puts it on screen unless it was turned off; no spend keeps it off
 * unless it was turned on.
 */
export function isShown(picked: Choice, heading: Heading): boolean {
  if (picked.on.includes(heading.id)) return true;
  return heading.hasSpend && !picked.off.includes(heading.id);
}

/** Turning one on clears any earlier off for it, and the other way round. */
function withHeading(picked: Choice, id: string, show: boolean): Choice {
  return show
    ? { on: [...picked.on, id], off: picked.off.filter((x) => x !== id) }
    : { on: picked.on.filter((x) => x !== id), off: [...picked.off, id] };
}

export function HeadingChooser({
  headings,
  categories,
  onCreated,
}: {
  /** Every heading that could be a card, whether or not it currently is. */
  headings: Heading[];
  /** The tree the create drawer files a new heading under. */
  categories: CategoryNode[];
  onCreated: () => void | Promise<void>;
}) {
  /* `categories.write` — the same permission the endpoint behind it demands. */
  const canCreate = useCan("categories.write");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const picked = useHeadingChoice();

  const [withSpend, quiet] = useMemo(
    () => [
      headings.filter((h) => h.hasSpend),
      headings.filter((h) => !h.hasSpend),
    ],
    [headings],
  );

  function toggle(heading: Heading) {
    setChoice(withHeading(picked, heading.id, !isShown(picked, heading)));
  }

  const row = (heading: Heading) => (
    <label
      key={heading.id}
      className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm transition hover:bg-surface-muted"
    >
      <input
        type="checkbox"
        checked={isShown(picked, heading)}
        onChange={() => toggle(heading)}
        className="size-4 accent-[var(--primary)]"
      />
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ background: heading.color }}
      />
      <span className="min-w-0 flex-1 truncate">{heading.name}</span>
      {heading.hasSpend ? (
        <Amount
          value={heading.total}
          tone="neutral"
          className="shrink-0 text-xs text-muted-foreground"
        />
      ) : (
        <span className="shrink-0 text-xs text-muted-foreground">
          nothing yet
        </span>
      )}
    </label>
  );

  return (
    <>
      {/*
        The word matches what the drawer can do FOR THIS PERSON.

        "add category" is the owner's own label and stays for anybody who can
        create one. For a reader the create block below is hidden, so all the
        drawer offers them is the tick list — and a button promising to add a
        category, opening a panel that cannot, is the kind of small lie a
        view-only role meets all day. They still get the panel; it just says
        what it is.
      */}
      <Button variant="secondary" size="md" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        {canCreate ? "add category" : "Choose cards"}
      </Button>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Headings on this screen"
        description="Tick as many as you want a card for. Everything stays in the books either way."
      >
        <div className="flex flex-col gap-1">
          {headings.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              There are no expense headings yet. Create one below.
            </p>
          ) : (
            <>
              {withSpend.map(row)}

              {quiet.length > 0 ? (
                <>
                  {/*
                    Below the ones money actually went to, and labelled. A card
                    reading zero is a deliberate choice to keep a heading in
                    view, not the screen having lost the figure.
                  */}
                  <p className="mt-3 mb-1 px-2 text-xs font-medium text-muted-foreground">
                    Nothing spent under these this period
                  </p>
                  {quiet.map(row)}
                </>
              ) : null}
            </>
          )}
        </div>

        {/*
          Below a rule and worded as what it is. Ticking a card is a
          preference; this changes what every expense form in the app offers,
          and it is not undone by unticking a box.

          Which is exactly why it is gated and the ticking above is not. The
          tick list lives in this browser's `localStorage` — a view-only role
          arranging their own cards writes nothing and should keep doing it.
          Creating a heading is a change to the company's books, and a role
          that may not make one should not be offered the button:
          *"jegula write action diye thake button oigula hide thakbe"*.
        */}
        {canCreate ? (
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-sm font-medium">
              Need a heading that is not here?
            </p>
            <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
              A new one appears everywhere expenses are recorded, not just on
              this screen.
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCreating(true)}
            >
              <Plus className="size-3.5" />
              Create a heading
            </Button>
          </div>
        ) : null}
      </Drawer>

      <NewCategoryDrawer
        open={creating}
        initialName=""
        parents={categories}
        kind="out"
        onClose={() => setCreating(false)}
        onCreated={async (created) => {
          // Turned on as it is made. Somebody who has just named a heading on
          // this screen means to see it here, and it has no spend yet, so
          // nothing would appear otherwise.
          setChoice(withHeading(choice, created.id, true));
          setCreating(false);
          setOpen(false);
          await onCreated();
        }}
      />
    </>
  );
}

"use client";

import { Plus } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { NewCategoryDrawer } from "@/components/ledger/category-select";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import type { CategoryNode } from "@/lib/masters";

/**
 * Which heading cards the Expenses page shows, and a way to make a new one.
 *
 * Two things behind one button, because the owner asked for both and they are
 * genuinely different weights — which is the thing this drawer has to make
 * visible. Ticking a card off is a preference, on this screen, for this
 * person, undone by ticking it back on. Creating a heading changes the
 * company's books: it appears in every expense form, on every other expense
 * screen, and in Settings → Categories, and it is not undone from here.
 *
 * So the ticks are the body of the drawer and creating is a separate step at
 * the foot of it, behind its own drawer — not a third checkbox that happens to
 * be permanent.
 */

/** Remembered per browser, like the dashboard's card choice. */
const KEY = "svf-expense-headings";

let hidden: string[] = [];
let read = false;
const listeners = new Set<() => void>();

function snapshot(): string[] {
  return hidden;
}

function subscribe(listener: () => void) {
  if (!read) {
    read = true;
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) hidden = JSON.parse(raw) as string[];
    } catch {
      // Private browsing, or something that is not JSON any more. Showing
      // every heading is the safe way to be wrong.
    }
    if (hidden.length) queueMicrotask(() => listeners.forEach((l) => l()));
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setHidden(next: string[]) {
  hidden = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // As above. The choice holds for this visit and is not remembered.
  }
  listeners.forEach((listener) => listener());
}

/** The ids the reader has hidden. Empty on the server, which shows them all. */
export function useHiddenHeadings(): string[] {
  return useSyncExternalStore(subscribe, snapshot, () => []);
}

export function HeadingChooser({
  headings,
  categories,
  onCreated,
}: {
  /** Every heading the period has, whether or not it is currently shown. */
  headings: { id: string; name: string }[];
  /** The tree the create drawer files a new heading under. */
  categories: CategoryNode[];
  onCreated: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const hiddenIds = useHiddenHeadings();

  function toggle(id: string) {
    setHidden(
      hiddenIds.includes(id)
        ? hiddenIds.filter((x) => x !== id)
        : [...hiddenIds, id],
    );
  }

  return (
    <>
      <Button variant="secondary" size="md" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        add category
      </Button>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Headings on this screen"
        description="Which cards you see here. Everything stays in the books either way."
      >
        <div className="flex flex-col gap-1">
          {headings.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nothing was spent in this period, so there is nothing to show or
              hide yet.
            </p>
          ) : (
            headings.map((heading) => (
              <label
                key={heading.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm transition hover:bg-surface-muted"
              >
                <input
                  type="checkbox"
                  checked={!hiddenIds.includes(heading.id)}
                  onChange={() => toggle(heading.id)}
                  className="size-4 accent-[var(--primary)]"
                />
                {heading.name}
              </label>
            ))
          )}
        </div>

        {/*
          Below a rule and worded as what it is. Hiding a card is a preference;
          this changes what every expense form in the app offers, and it is not
          undone by unticking a box.
        */}
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-sm font-medium">
            Need a heading that is not here?
          </p>
          <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
            A new one appears everywhere expenses are recorded, not just on this
            screen.
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
      </Drawer>

      <NewCategoryDrawer
        open={creating}
        initialName=""
        parents={categories}
        kind="out"
        onClose={() => setCreating(false)}
        onCreated={async () => {
          setCreating(false);
          setOpen(false);
          await onCreated();
        }}
      />
    </>
  );
}

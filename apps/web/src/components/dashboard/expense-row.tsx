"use client";

import type { OverviewReport } from "@finance/shared";
import { Check, Plus, RotateCcw, Settings2, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import {
  DEFAULT_CARDS,
  MAX_CARDS,
  buildCatalogue,
  placeholderFor,
  type CardSpec,
} from "@/components/dashboard/expense-cards";
import { formatMoney } from "@finance/shared";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  SectionHeading,
  ShareBar,
  StatCell,
  StatStrip,
} from "@/components/ui/patterns";
import { Card } from "@/components/ui/card";
import { useDismissable } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";

/**
 * Where the choice is kept, and why it is not in the database.
 *
 * This is a layout preference — which four figures somebody wants at the top of
 * their own screen — not a fact about the company's money. Nothing downstream
 * reads it, no report changes because of it, and losing it costs one visit to
 * the chooser rather than any data.
 *
 * The app has no migration files (schema changes go through `drizzle-kit
 * push`), so a per-user column would mean a hand-run command against the live
 * finance database to deliver a preference about card order. That trade is the
 * wrong way round. If it should follow somebody between their laptop and their
 * phone, that is the point at which it earns a column.
 *
 * Versioned in the key, so changing what the keys mean later cannot leave
 * somebody with a row of cards that no longer exist.
 */
const STORAGE_KEY = "sfm.dashboard.expense-cards.v1";

/**
 * A chosen card: its key, and the name it had when it was chosen.
 *
 * The name is carried only so a category card can still say which heading it is
 * about in a month where nothing was spent under it — that month's report does
 * not mention the category at all, so there is nowhere else for the word to
 * come from. Whenever the catalogue does have the card, the catalogue's own
 * label wins, so renaming a category shows through immediately.
 */
type Chosen = { k: string; l?: string };

const FALLBACK: Chosen[] = DEFAULT_CARDS.map((k) => ({ k }));

/**
 * The saved row, read the way React wants a browser-only value read.
 *
 * The obvious version — `useState(defaults)` and a `useEffect` that reads
 * storage and calls `setChosen` — is wrong twice. It renders the defaults and
 * then replaces them, which is a visible flicker on every load; and it is a
 * setState inside an effect, which the lint rule here catches because it has
 * already caused cascading renders in this codebase twice.
 *
 * `useSyncExternalStore` is built for exactly this: a server snapshot for the
 * server render and the hydration that matches it, a client snapshot after,
 * and no effect in between. The one rule it imposes is that the snapshot be
 * referentially stable — returning a fresh array each call makes React think
 * the store changed on every render and re-render forever — so the parse is
 * cached against the raw string it came from.
 */
let cachedRaw: string | null | undefined;
let cachedCards: Chosen[] = FALLBACK;
const listeners = new Set<() => void>();

function readChosen(): Chosen[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private browsing, or storage blocked by policy. The defaults are a fine
    // answer, and a dashboard that fails to render over a card preference
    // would not be.
    return FALLBACK;
  }

  if (raw === cachedRaw) return cachedCards;
  cachedRaw = raw;

  if (!raw) {
    cachedCards = FALLBACK;
    return cachedCards;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    // Anything that is not a `{k}` object is dropped rather than trusted. This
    // is the one place the app reads something a person could have edited by
    // hand, and a bad entry here would render as a card with no key.
    const cards = Array.isArray(parsed)
      ? parsed
          .filter(
            (entry): entry is Chosen =>
              typeof entry === "object" &&
              entry !== null &&
              typeof (entry as Chosen).k === "string",
          )
          .map(({ k, l }) => ({ k, l: typeof l === "string" ? l : undefined }))
      : [];
    // An empty saved row would leave the section as a heading over nothing,
    // which reads as broken rather than as chosen.
    cachedCards = cards.length ? cards.slice(0, MAX_CARDS) : FALLBACK;
  } catch {
    cachedCards = FALLBACK;
  }
  return cachedCards;
}

function serverChosen(): Chosen[] {
  return FALLBACK;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // `storage` fires in the *other* tabs, not the one that wrote — so a second
  // window open on the dashboard follows along instead of showing a stale row.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Writes, then tells this tab. */
function saveChosen(cards: Chosen[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
  } catch {
    // Nothing to say to somebody who did not ask for anything to be stored.
    // The row still changes for this visit; it just will not be remembered.
  }
  for (const listener of listeners) listener();
}

export function ExpenseRow({
  report,
  money,
}: {
  report: OverviewReport;
  money: (value: string, options?: { hideDecimals?: boolean }) => string;
}) {
  const catalogue = buildCatalogue(report, report.previous, money);
  const byKey = new Map(catalogue.map((card) => [card.key, card]));

  const chosen = useSyncExternalStore(subscribe, readChosen, serverChosen);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);

  const keys = new Set(chosen.map((entry) => entry.k));

  function add(card: CardSpec) {
    if (keys.has(card.key) || chosen.length >= MAX_CARDS) return;
    // The label travels with the key, so a month where this category has no
    // spending can still name it.
    saveChosen([...chosen, { k: card.key, l: card.label }]);
    setAdding(false);
  }

  function drop(key: string) {
    const next = chosen.filter((entry) => entry.k !== key);
    // Never down to nothing — the section would be a heading over empty space.
    if (!next.length) return;
    saveChosen(next);
  }

  function reset() {
    saveChosen(FALLBACK);
    setAdding(false);
  }

  /**
   * A chosen key with no figure behind it.
   *
   * A category card survives a month with no spending under that heading by
   * showing zero under its remembered name. Anything else — a key from an
   * older version of this file — is dropped rather than rendered as a mystery.
   */
  const cards = chosen
    .map((entry) => byKey.get(entry.k) ?? placeholderFor(entry.k, entry.l))
    .filter((card): card is CardSpec => Boolean(card));

  const available = catalogue.filter((card) => !keys.has(card.key));
  const full = chosen.length >= MAX_CARDS;

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading
        title="Expense overview"
        icon="receipt_long"
        iconTone="text-negative"
        qualifier={report.period.label}
        aside={
          <span className="flex items-center gap-3">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing((was) => !was);
                setAdding(false);
              }}
            >
              {editing ? (
                <>
                  <Check className="size-3.5" />
                  Done
                </>
              ) : (
                <>
                  <Settings2 className="size-3.5" />
                  Choose cards
                </>
              )}
            </Button>
          </span>
        }
      />

      {editing ? (
        <p className="text-[13px] text-muted-foreground">
          Pick the figures worth watching. {chosen.length} of {MAX_CARDS} shown
          — remove one with the cross, add one with the tile at the end. Kept in
          this browser.
        </p>
      ) : null}

      {/* The same strip the account blocks use. It was a grid of separate
          cards, which read as a different kind of thing on a page where the
          two above it are strips — and they are all four-figures-in-a-row. */}
      <StatStrip>
        {cards.map((card) => {
          const share = card.shareOfOutflow
            ? shareOf(card.value, report.totals.moneyOut)
            : null;
          return (
            <div key={card.key} className="relative bg-surface">
              <StatCell
                label={card.label}
                icon={card.symbol}
                iconTone={card.iconTone}
                // Formatted here, where the cell only renders what it is given.
                // Passing the raw string printed "68875.00" under a heading whose
                // neighbours read ৳11,83,000.00 — the same figures, one of them
                // looking like a database column.
                value={money(card.value)}
                secondary={
                  card.usd
                    ? `≈ ${formatMoney(card.usd, { currency: "USD" })}`
                    : null
                }
                footnote={
                  // The share, then whatever the card had to say. A figure with
                  // no denominator is a figure nobody can size: ৳68,875 means one
                  // thing against a two-lakh month and another against a
                  // twenty-four-lakh one.
                  [share, card.hint].filter(Boolean).join(" · ")
                }
              >
                {share ? (
                  <ShareBar
                    share={Number(card.value) / Number(report.totals.moneyOut)}
                    tone="bg-primary"
                  />
                ) : null}
              </StatCell>
              {editing ? (
                <button
                  type="button"
                  onClick={() => drop(card.key)}
                  aria-label={`Remove ${card.label}`}
                  // Disabled rather than hidden on the last one, so it is clear
                  // the cross exists and why it will not go.
                  disabled={cards.length === 1}
                  title={
                    cards.length === 1
                      ? "The row cannot be empty"
                      : `Remove ${card.label}`
                  }
                  className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground shadow-e1 transition hover:border-negative hover:bg-negative/10 hover:text-negative disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-surface disabled:hover:text-muted-foreground"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
          );
        })}

        {editing && !full ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex min-h-[7.5rem] cursor-pointer flex-col items-center justify-center gap-2 bg-surface text-sm text-muted-foreground transition hover:text-primary-text"
          >
            <Plus className="size-5" />
            Add a card
          </button>
        ) : null}
      </StatStrip>

      {editing ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="ghost" onClick={reset}>
            <RotateCcw className="size-3.5" />
            Back to the usual four
          </Button>
          {full ? (
            <span className="text-xs text-muted-foreground">
              That is as many as the row holds. Remove one to add another.
            </span>
          ) : null}
        </div>
      ) : null}

      <CardChooser
        open={adding}
        options={available}
        money={money}
        onPick={add}
        onClose={() => setAdding(false)}
      />
    </section>
  );
}

/**
 * The list of everything that is not already on the row.
 *
 * Each option shows its figure, because "Office rent" and "Office rent —
 * ৳45,000" are different amounts of help when somebody is deciding whether it
 * is worth a card.
 */
/**
 * What share of the month's spending this figure is.
 *
 * Null rather than "0%" when there is nothing to divide by — a percentage of a
 * month with no outflow is not zero, it is undefined, and printing 0% asserts
 * something the data does not say.
 */
function shareOf(value: string, total: string): string | null {
  const whole = Number(total);
  if (!Number.isFinite(whole) || whole <= 0) return null;
  return `${Math.round((Number(value) / whole) * 100)}% of outflow`;
}

function CardChooser({
  open,
  options,
  money,
  onPick,
  onClose,
}: {
  open: boolean;
  options: CardSpec[];
  money: (value: string, options?: { hideDecimals?: boolean }) => string;
  onPick: (card: CardSpec) => void;
  onClose: () => void;
}) {
  useDismissable(open, onClose);

  if (!open) return null;

  const groups = ["Spending", "Tax", "Position", "By category"] as const;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-[10vh]"
      onClick={onClose}
    >
      <Card
        // Clicks inside must not reach the backdrop's dismiss.
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Add a card"
        className="w-full max-w-lg overflow-hidden p-0"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h3 className="text-sm font-semibold">Add a card</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {options.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              Everything is already on the row.
            </p>
          ) : (
            groups.map((group) => {
              const inGroup = options.filter((card) => card.group === group);
              if (!inGroup.length) return null;
              return (
                <div key={group} className="mb-1">
                  <p className="px-3 pt-2 pb-1 text-[0.6875rem] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
                    {group}
                  </p>
                  {inGroup.map((card) => (
                    <button
                      key={card.key}
                      type="button"
                      onClick={() => onPick(card)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition",
                        "hover:bg-surface-muted",
                      )}
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted-foreground">
                        <Icon
                          name={card.symbol}
                          size={18}
                          className={card.iconTone}
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {card.label}
                        </span>
                        {card.hint ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {card.hint}
                          </span>
                        ) : null}
                      </span>
                      <span className="num shrink-0 text-sm text-muted-foreground">
                        {money(card.value, { hideDecimals: true })}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}

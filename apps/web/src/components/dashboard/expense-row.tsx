"use client";

import { formatMoney, type OverviewReport } from "@finance/shared";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowCounterClockwise";
import { CheckIcon } from "@phosphor-icons/react/dist/ssr/Check";
import { PlusCircleIcon } from "@phosphor-icons/react/dist/ssr/PlusCircle";
import { ReceiptIcon } from "@phosphor-icons/react/dist/ssr/Receipt";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import { useState, useSyncExternalStore } from "react";

import {
  DEFAULT_CARDS,
  MAX_CARDS,
  buildCatalogue,
  placeholderFor,
  type CardSpec,
} from "@/components/dashboard/expense-cards";
import {
  FIGURE_GRID,
  FigureCard,
  SectionHead,
} from "@/components/dashboard/figure-card";
import { useDismissable } from "@/components/ui/overlay";

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
    <section
      className="sv-rise flex flex-col gap-3"
      style={{ animationDelay: "0.2s" }}
    >
      <SectionHead
        icon={ReceiptIcon}
        tile="violet"
        title="Expense overview"
        subtitle={report.period.label}
        aside={
          <button
            type="button"
            onClick={() => {
              setEditing((was) => !was);
              setAdding(false);
            }}
            className="sv-button-quiet inline-flex h-10 cursor-pointer items-center gap-[7px] rounded-lg bg-(--sv-surface) px-3.5 text-[13.5px] font-extrabold"
          >
            {editing ? (
              <>
                <CheckIcon
                  weight="duotone"
                  size={17}
                  className="text-(--sv-violet)"
                />
                Done
              </>
            ) : (
              <>
                <PlusCircleIcon
                  weight="duotone"
                  size={17}
                  className="text-(--sv-violet)"
                />
                {/* The owner's word. It both adds and removes, so "Add"
                    undersells it — but the panel it opens says what it
                    does, and this is the vocabulary they use. */}
                Add
              </>
            )}
          </button>
        }
      />

      {editing ? (
        <p className="text-[13px] text-(--sv-muted)">
          Pick the figures worth watching. {chosen.length} of {MAX_CARDS} shown
          — remove one with the cross, add one with the tile at the end. Kept in
          this browser.
        </p>
      ) : null}

      <div className={FIGURE_GRID}>
        {cards.map((card) => {
          const share = card.shareOfOutflow
            ? shareOf(card.value, report.totals.moneyOut)
            : null;
          return (
            <FigureCard
              key={card.key}
              icon={card.symbol}
              label={card.label}
              // Formatted here: the card only renders what it is given, and a
              // raw "68875.00" beside neighbours reading ৳11,83,000.00 looks
              // like a database column.
              value={money(card.value)}
              sub={
                card.usd
                  ? `≈ ${formatMoney(card.usd, { currency: "USD" })}`
                  : null
              }
              // The share, then whatever the card had to say. A figure with no
              // denominator is a figure nobody can size: ৳68,875 means one
              // thing against a two-lakh month and another against a
              // twenty-four-lakh one.
              note={[share, card.hint].filter(Boolean).join(" · ") || null}
            >
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
                  className="sv-button-quiet absolute top-2.5 right-2.5 grid size-7 cursor-pointer place-items-center rounded-full bg-(--sv-surface) text-(--sv-muted) disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <XIcon weight="bold" size={13} />
                </button>
              ) : null}
            </FigureCard>
          );
        })}

        {editing && !full ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="sv-add-card flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-[11px] text-[14px] font-extrabold text-(--sv-violet-ink)"
          >
            <PlusCircleIcon
              weight="duotone"
              size={26}
              className="text-(--sv-violet)"
            />
            Add a card
          </button>
        ) : null}
      </div>

      {editing ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="sv-button-quiet inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-(--sv-surface) px-3 text-[13px] font-extrabold"
          >
            <ArrowCounterClockwiseIcon
              weight="duotone"
              size={16}
              className="text-(--sv-violet)"
            />
            Back to the usual four
          </button>
          {full ? (
            <span className="text-[12.5px] text-(--sv-muted)">
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

/**
 * The list of everything that is not already on the row.
 *
 * Each option shows its figure, because "Office rent" and "Office rent —
 * ৳45,000" are different amounts of help when somebody is deciding whether it
 * is worth a card.
 */
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
      <div
        // Clicks inside must not reach the backdrop's dismiss.
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Add a card"
        className="sv-card w-full max-w-lg overflow-hidden rounded-[11px] bg-(--sv-surface)"
      >
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <h3 className="text-[16px] font-extrabold">Add a card</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 cursor-pointer place-items-center rounded-lg text-(--sv-muted) transition-colors hover:bg-(--sv-violet-tint) hover:text-(--sv-violet-ink)"
          >
            <XIcon weight="bold" size={15} />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {options.length === 0 ? (
            <p className="px-3 py-8 text-center text-[14px] text-(--sv-muted)">
              Everything is already on the row.
            </p>
          ) : (
            groups.map((group) => {
              const inGroup = options.filter((card) => card.group === group);
              if (!inGroup.length) return null;
              return (
                <div key={group} className="mb-1">
                  <p className="px-3 pt-2 pb-1 text-[11px] font-extrabold tracking-[0.12em] text-(--sv-muted) uppercase">
                    {group}
                  </p>
                  {inGroup.map((card) => (
                    <button
                      key={card.key}
                      type="button"
                      onClick={() => onPick(card)}
                      className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-(--sv-violet-tint)"
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-(--sv-violet-tint) text-(--sv-violet)">
                        <card.symbol weight="duotone" size={18} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-bold">
                          {card.label}
                        </span>
                        {card.hint ? (
                          <span className="block truncate text-[12.5px] text-(--sv-muted)">
                            {card.hint}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-[14px] text-(--sv-muted) tabular-nums">
                        {money(card.value, { hideDecimals: true })}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

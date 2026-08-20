"use client";

import {
  ACCOUNT_TYPE_LABELS,
  formatMoney,
  type AccountGroup,
  type AccountType,
} from "@finance/shared";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  SectionHeading,
  ShareBar,
  StatCell,
  StatStrip,
} from "@/components/ui/patterns";
import { cn } from "@/lib/utils";

/**
 * Where the order is kept, and why it is not in the database.
 *
 * The owner asked for the dashboard to have its own order. The accounts page
 * keeps `sort_order` and every dropdown in the app follows it; arranging this
 * screen was not to move that. So this is a layout preference — the same kind
 * of thing as which four figures the expense row shows — and it is kept the
 * same way: in the browser, versioned in the key, and worth nothing if it is
 * lost. Nothing downstream reads it and no figure changes because of it.
 *
 * The cost is that it does not follow anybody to another machine. That is the
 * moment it earns a column, and not before: a preference about the order of a
 * few headings is not a reason to migrate a live finance database.
 */
const STORAGE_KEY = "sfm.dashboard.account-order.v1";

/**
 * The order before anybody chooses one: where the company's money sits first,
 * and the card it spends on last.
 *
 * The server hands these over by `sort_order` then name, which on the live
 * data puts the card above the bank that settles it. That is the accounts
 * page's order and it is not wrong there — it is simply not the order somebody
 * opening the dashboard wants, and the two no longer have to agree.
 */
const TYPE_RANK: Record<AccountType, number> = {
  bank: 0,
  mobile_wallet: 1,
  cash: 2,
  card: 3,
};

/** Stable: equal rank keeps the server's own order between two accounts. */
function defaultOrder(groups: AccountGroup[]): AccountGroup[] {
  return groups
    .map((group, index) => ({ group, index }))
    .sort(
      (a, b) =>
        TYPE_RANK[a.group.type] - TYPE_RANK[b.group.type] || a.index - b.index,
    )
    .map((entry) => entry.group);
}

/**
 * The saved order, applied to whatever accounts exist now.
 *
 * Ids that are saved but gone — an account deleted since — fall out. Accounts
 * that exist but were never ordered go to the end rather than vanishing: an
 * account opened tomorrow has to appear somewhere, and appearing nowhere is
 * how somebody loses sight of a balance.
 */
function applyOrder(groups: AccountGroup[], saved: string[]): AccountGroup[] {
  if (!saved.length) return defaultOrder(groups);

  const byId = new Map(groups.map((group) => [group.key, group]));
  const known = saved
    .map((id) => byId.get(id))
    .filter((group): group is AccountGroup => group !== undefined);

  const placed = new Set(known.map((group) => group.key));
  const rest = defaultOrder(groups).filter((group) => !placed.has(group.key));

  return [...known, ...rest];
}

/**
 * Read the way React wants a browser-only value read.
 *
 * `useState` plus an effect renders the server's order and then replaces it,
 * which is a visible jump on every load, and it is a setState inside an effect
 * — the thing the lint rule here exists to catch. `useSyncExternalStore` has a
 * server snapshot for the server render and a client one after it. Its single
 * rule is that the snapshot be referentially stable, so the parse is cached
 * against the raw string it came from; a fresh array on every call makes React
 * believe the store changed and re-render forever.
 */
const NONE: string[] = [];
let cachedRaw: string | null | undefined;
let cachedOrder: string[] = NONE;
const listeners = new Set<() => void>();

function readOrder(): string[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private browsing, or storage blocked by policy. The default order is a
    // fine answer; a dashboard that fails to render over one would not be.
    return NONE;
  }

  if (raw === cachedRaw) return cachedOrder;
  cachedRaw = raw;

  if (!raw) {
    cachedOrder = NONE;
    return cachedOrder;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    // Anything that is not a list of strings is dropped rather than trusted —
    // this is a value somebody can edit by hand.
    cachedOrder = Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : NONE;
  } catch {
    cachedOrder = NONE;
  }
  return cachedOrder;
}

function serverOrder(): string[] {
  return NONE;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // `storage` fires in the *other* tabs, so a second window open on the
  // dashboard follows along instead of showing the order from before.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Writes, then tells this tab. An empty list forgets the choice. */
function saveOrder(ids: string[]) {
  try {
    if (ids.length) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Nothing to say to somebody who did not ask for anything to be stored.
    // The order still holds for this visit; it just will not be remembered.
  }
  for (const listener of listeners) listener();
}

/**
 * Every account's block, in the order somebody chose.
 *
 * Edit puts the blocks in hand: drag one, or move it with the arrows — which
 * is the same gesture for a keyboard and for a phone, where dragging a
 * full-width strip is a fight. Both write the same list.
 */
export function AccountBlocks({
  groups,
  ended,
  previousMonthName,
}: {
  groups: AccountGroup[];
  /** True when the month on screen is over, so the figure is a close. */
  ended: boolean;
  /** Where the opening figure came from — "Carried forward from July". */
  previousMonthName: string;
}) {
  const saved = useSyncExternalStore(subscribe, readOrder, serverOrder);
  const [editing, setEditing] = useState(false);
  /**
   * The order being arranged, held while editing.
   *
   * Dragging reorders many times a second and every one of those would
   * otherwise be a write; the draft absorbs them and the list is saved when
   * the block is dropped. An arrow saves as it goes, because one click is the
   * whole gesture.
   */
  const [draft, setDraft] = useState<string[] | null>(null);
  /**
   * The block in hand, in a ref as well as in state.
   *
   * State is for the look of it — the block being carried is faded. The ref is
   * what the handler reads: `dragover` can arrive in the same tick as
   * `dragstart`, before React has re-rendered with the new state, and a drag
   * that depends on a render having happened is a drag that sometimes does
   * nothing at all.
   */
  const carried = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const shown = applyOrder(groups, editing && draft ? draft : saved);
  const ids = shown.map((group) => group.key);

  function move(from: number, to: number, persist: boolean) {
    if (from === to || to < 0 || to >= ids.length) return;
    const next = ids.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDraft(next);
    if (persist) saveOrder(next);
  }

  return (
    <>
      {/*
        The one control, in the corner the owner asked for.

        No heading beside it: every block below carries its own, and a heading
        over the top of them would be a level of hierarchy that does not exist.
      */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {editing ? (
          <p className="mr-auto text-[13px] text-muted-foreground">
            Drag a block, or move it with the arrows. Kept in this browser.
          </p>
        ) : null}

        {editing && saved.length ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              saveOrder(NONE);
              setDraft(defaultOrder(groups).map((group) => group.key));
            }}
          >
            Reset
          </Button>
        ) : null}

        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            if (editing) {
              if (draft) saveOrder(draft);
              setDraft(null);
              setEditing(false);
              return;
            }
            setDraft(ids);
            setEditing(true);
          }}
        >
          {editing ? "Done" : "Edit"}
        </Button>
      </div>

      {shown.map((group, index) => (
        <AccountBlock
          key={group.key}
          group={group}
          ended={ended}
          previousMonthName={previousMonthName}
          editing={editing}
          dragging={dragging === group.key}
          first={index === 0}
          last={index === shown.length - 1}
          onMove={(direction) => move(index, index + direction, true)}
          onDragStart={() => {
            carried.current = group.key;
            setDragging(group.key);
          }}
          onDragOver={() => {
            const id = carried.current;
            if (!editing || !id || id === group.key) return;
            move(ids.indexOf(id), index, false);
          }}
          onDragEnd={() => {
            carried.current = null;
            if (draft) saveOrder(draft);
            setDragging(null);
          }}
        />
      ))}
    </>
  );
}

/**
 * The same four the Accounts screen uses, so a card is a card on both.
 *
 * Deliberately a copy rather than a shared export: it is four lines, and
 * lifting it into `lib/` to save them would put a file every screen imports in
 * the path of a dashboard change.
 */
const ICONS: Record<AccountType, string> = {
  bank: "account_balance",
  cash: "payments",
  mobile_wallet: "smartphone",
  card: "credit_card",
};

/**
 * One account: where it started, what moved, where it stands.
 *
 * The four read left to right as a sentence, and they tie —
 * opening + in − out is exactly current. Four figures in a box that do not add
 * up are four unrelated numbers, and a reader who checks once and finds they
 * disagree stops trusting the whole screen. The footnote under the last cell
 * says the arithmetic out loud so nobody has to work out whether it holds.
 */
function AccountBlock({
  group,
  ended,
  previousMonthName,
  editing,
  dragging,
  first,
  last,
  onMove,
  onDragStart,
  onDragOver,
  onDragEnd,
}: {
  group: AccountGroup;
  /** True when the month on screen is over, so the figure is a close. */
  ended: boolean;
  /** Where the opening figure came from — "Carried forward from July". */
  previousMonthName: string;
  /** True while the order is being arranged: handles out, block draggable. */
  editing: boolean;
  /** True while this is the block in hand. */
  dragging: boolean;
  first: boolean;
  last: boolean;
  /** -1 for up, 1 for down. */
  onMove: (direction: -1 | 1) => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDragEnd: () => void;
}) {
  const inflow = Number(group.moneyIn);
  const outflow = Number(group.moneyOut);
  // In plus out, not in minus out: this is the denominator the two share bars
  // divide by, so it is how much moved rather than which way it went.
  const moved = inflow + outflow;

  return (
    <section
      className={cn(
        "flex flex-col gap-3",
        editing && "cursor-grab",
        // Faded rather than pulled out: a gap where the block was is a list
        // that jumps, and the eye loses which one it is carrying.
        dragging && "opacity-50",
      )}
      draggable={editing}
      onDragStart={onDragStart}
      onDragOver={(event) => {
        if (!editing) return;
        // Without this the drop is refused and the gesture does nothing at all.
        event.preventDefault();
        onDragOver();
      }}
      onDrop={(event) => event.preventDefault()}
      onDragEnd={onDragEnd}
    >
      {/*
        One heading per account, and the account names itself.

        This block used to be a whole currency: "BD Bank overview" over the sum
        of the bank, the card and the petty cash, their names crammed into the
        grey line beside it. Two accounts, one row of figures, and no way to
        read either one on its own. Now the name is the heading and the sub-line
        says what kind of place the money sits in, which is the one thing the
        name does not always tell you.
      */}
      <SectionHeading
        title={group.label}
        icon={ICONS[group.type] ?? "account_balance"}
        iconTone="text-primary-text"
        qualifier={ACCOUNT_TYPE_LABELS[group.type] ?? group.type}
        aside={
          editing ? (
            <span className="flex items-center gap-1">
              <GripVertical className="size-4 text-faint" aria-hidden />
              {/* Disabled at the ends rather than hidden, so the pair does not
                  shift about as a block travels up the list. */}
              <Handle
                label={`Move ${group.label} up`}
                disabled={first}
                onClick={() => onMove(-1)}
              >
                <ArrowUp className="size-3.5" />
              </Handle>
              <Handle
                label={`Move ${group.label} down`}
                disabled={last}
                onClick={() => onMove(1)}
              >
                <ArrowDown className="size-3.5" />
              </Handle>
            </span>
          ) : null
        }
      />

      <StatStrip>
        {/* "Opening balance", not "Opening bank balance": the heading above
            already says which account this is, and the longer label was the one
            that wrapped. */}
        <StatCell
          label="Opening balance"
          icon="history"
          value={money(group.opening)}
          secondary={usd(group.usd.opening)}
          footnote={`Carried forward from ${previousMonthName}`}
        />

        <StatCell
          label="Cash inflow"
          tone="positive"
          icon="south_west"
          iconTone="text-positive"
          value={money(group.moneyIn)}
          secondary={usd(group.usd.moneyIn)}
        >
          {/* How the month split between arriving and leaving. Drawn only when
              something moved: a full-width bar over two zeroes reads as a
              hundred per cent of nothing. */}
          {moved > 0 ? (
            <>
              <ShareBar share={inflow / moved} tone="bg-positive" />
              <p className="text-[13px] text-muted-foreground">
                {Math.round((inflow / moved) * 100)}% of total movement
              </p>
            </>
          ) : null}
        </StatCell>

        <StatCell
          label="Cash outflow"
          tone="negative"
          icon="north_east"
          iconTone="text-negative"
          value={money(group.moneyOut)}
          secondary={usd(group.usd.moneyOut)}
        >
          {moved > 0 ? (
            <>
              <ShareBar share={outflow / moved} tone="bg-negative" />
              <p className="text-[13px] text-muted-foreground">
                {Math.round((outflow / moved) * 100)}% of total movement
              </p>
            </>
          ) : null}
        </StatCell>

        {/*
          The same figure under two names, and both are accurate.

          It has always been the *period's* close — opening as at the first of
          the month, plus what moved during it. On the month in progress that is
          what the accounts hold right now, so "Current balance" is the honest
          word. Look back at July from August and the number does not change
          meaning, but the word does: it is what July closed at, which is
          exactly what August opened with. Calling that "current" invites
          somebody to read a two-month-old figure as today's cash.
        */}
        <StatCell
          emphasis
          label={ended ? "Closing balance" : "Current balance"}
          icon="account_balance_wallet"
          iconTone="text-primary-text"
          value={money(group.closing)}
          secondary={usd(group.usd.closing)}
          footnote={
            ended
              ? "what the month closed at, and what the next opened with"
              : "opening + in − out"
          }
        />
      </StatStrip>
    </section>
  );
}

/**
 * The dollar line under a figure.
 *
 * Grouped and marked approximate. It was printing the raw string, so a
 * thirty-two-thousand-dollar balance read as "$32579.88" — the one number on
 * the screen with no separators, directly under one that had them.
 */
function usd(value: string | null): string | null {
  return value === null ? null : `≈ ${formatMoney(value, { currency: "USD" })}`;
}

/**
 * Taka, always — including the card's block.
 *
 * `group.currency` says what the card is *denominated* in; it does not say
 * what these four figures are in. Every amount in this system is recorded in
 * BDT, the card's included, with the foreign figure kept beside it on the
 * transaction. Formatting the block in dollars because the account is a dollar
 * one printed "$69,537.00" over "≈ $587.80" — the same money, two currencies,
 * off by a factor of a hundred and eighteen.
 */
function money(value: string): string {
  return formatMoney(value, { currency: "BDT" });
}

/** One of the two arrows beside a heading while the order is being arranged. */
function Handle({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-7 cursor-pointer items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground transition hover:border-primary hover:text-primary-text disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground"
    >
      {children}
    </button>
  );
}

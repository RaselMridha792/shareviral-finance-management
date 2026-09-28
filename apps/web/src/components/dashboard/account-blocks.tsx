"use client";

import {
  ACCOUNT_TYPE_LABELS,
  formatMoney,
  type AccountGroup,
  type AccountType,
} from "@finance/shared";
import type { Icon } from "@phosphor-icons/react";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowCounterClockwise";
import { ArrowDownIcon } from "@phosphor-icons/react/dist/ssr/ArrowDown";
import { ArrowDownLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowDownLeft";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/ssr/ArrowUp";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowUpRight";
import { BankIcon } from "@phosphor-icons/react/dist/ssr/Bank";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ClockCounterClockwise";
import { CreditCardIcon } from "@phosphor-icons/react/dist/ssr/CreditCard";
import { DeviceMobileIcon } from "@phosphor-icons/react/dist/ssr/DeviceMobile";
import { DotsSixVerticalIcon } from "@phosphor-icons/react/dist/ssr/DotsSixVertical";
import { MoneyIcon } from "@phosphor-icons/react/dist/ssr/Money";
import { WalletIcon } from "@phosphor-icons/react/dist/ssr/Wallet";
import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import {
  FIGURE_GRID,
  FigureCard,
  SectionHead,
} from "@/components/dashboard/figure-card";
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
 * Arranging is switched on from the greeting card's Edit, where the handoff
 * puts it; while it is on, each block can be dragged, or moved with the arrows
 * beside its name — the same gesture for a keyboard and for a phone, where
 * dragging a full-width block is a fight. Both write the same list.
 */
export function AccountBlocks({
  groups,
  ended,
  previousMonthName,
  editing,
  range,
}: {
  groups: AccountGroup[];
  /** True when the month on screen is over, so the figure is a close. */
  ended: boolean;
  /** Where the opening figure came from — "Carried forward from July". */
  previousMonthName: string;
  /** Whether the order is being arranged. The Edit button owns this. */
  editing: boolean;
  /** The month on screen as dates — what a card's register opens on. */
  range: { from: string; to: string };
}) {
  const saved = useSyncExternalStore(subscribe, readOrder, serverOrder);
  /**
   * The order being arranged, held while dragging.
   *
   * Dragging reorders many times a second and every one of those would
   * otherwise be a write; the draft absorbs them and the list is saved when
   * the block is dropped. An arrow saves as it goes, because one click is the
   * whole gesture. The parent remounts this component when arranging ends, so
   * a draft never outlives the session it was made in.
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

  /*
   * Every account can be off the dashboard at once — the server keeps back any
   * account at zero that the month never touched.
   */
  if (shown.length === 0) {
    return (
      <p className="py-2 text-[14px] text-(--sv-muted)">
        No account held or moved money this month. Accounts standing at zero
        with nothing recorded stay off the dashboard — they are all still on the
        Accounts screen.
      </p>
    );
  }

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
      {editing ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="mr-auto text-[13px] text-(--sv-muted)">
            Drag an account, or move it with the arrows beside its name. Kept in
            this browser.
          </p>
          {saved.length ? (
            <button
              type="button"
              onClick={() => {
                saveOrder(NONE);
                setDraft(defaultOrder(groups).map((group) => group.key));
              }}
              className="sv-button-quiet inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-(--sv-surface) px-3 text-[13px] font-extrabold"
            >
              <ArrowCounterClockwiseIcon
                weight="duotone"
                size={16}
                className="text-(--sv-violet)"
              />
              Reset the order
            </button>
          ) : null}
        </div>
      ) : null}

      {shown.map((group, index) => (
        <AccountBlock
          key={group.key}
          group={group}
          ended={ended}
          previousMonthName={previousMonthName}
          editing={editing}
          range={range}
          dragging={dragging === group.key}
          first={index === 0}
          last={index === shown.length - 1}
          delay={0.08 + index * 0.06}
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
 * The same four kinds the Accounts screen has, as the handoff's icons.
 *
 * Deliberately a copy rather than a shared export: it is four lines, and
 * lifting it into `lib/` to save them would put a file every screen imports in
 * the path of a dashboard change.
 */
const ICONS: Record<AccountType, Icon> = {
  bank: BankIcon,
  cash: MoneyIcon,
  mobile_wallet: DeviceMobileIcon,
  card: CreditCardIcon,
};

/**
 * One account: where it started, what moved, where it stands.
 *
 * The four read left to right as a sentence, and they tie —
 * opening + in − out is exactly current. Four figures that do not add up are
 * four unrelated numbers, and a reader who checks once and finds they disagree
 * stops trusting the whole screen. The note under the last card says the
 * arithmetic out loud so nobody has to work out whether it holds.
 */
function AccountBlock({
  group,
  ended,
  previousMonthName,
  editing,
  range,
  dragging,
  first,
  last,
  delay,
  onMove,
  onDragStart,
  onDragOver,
  onDragEnd,
}: {
  group: AccountGroup;
  ended: boolean;
  previousMonthName: string;
  /** True while the order is being arranged: handles out, block draggable. */
  editing: boolean;
  range: { from: string; to: string };
  /** True while this is the block in hand. */
  dragging: boolean;
  first: boolean;
  last: boolean;
  /** Seconds before this block rises in, so a column of them staggers. */
  delay: number;
  /** -1 for up, 1 for down. */
  onMove: (direction: -1 | 1) => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDragEnd: () => void;
}) {
  const inflow = Number(group.moneyIn);
  const outflow = Number(group.moneyOut);
  // In plus out, not in minus out: this is how much moved, whichever way.
  const moved = inflow + outflow;
  const shareOf = (part: number) =>
    moved > 0
      ? `${Math.round((part / moved) * 100)}% of total movement`
      : "Nothing moved this period";
  /*
   * Where the four cards lead: this account's register for the month on
   * screen — the opening it starts from, every entry in and out, and the
   * running balance it closes on. The owner: "dashboard a nicer card gula
   * jate clickable thake". Not while arranging, when a click means a drag.
   */
  const register = editing
    ? undefined
    : `/accounts/${group.key}/register?from=${range.from}&to=${range.to}`;

  return (
    <section
      className={cn(
        "sv-rise flex flex-col gap-3",
        editing && "cursor-grab",
        // Faded rather than pulled out: a gap where the block was is a list
        // that jumps, and the eye loses which one it is carrying.
        dragging && "opacity-50",
      )}
      style={{ animationDelay: `${delay}s` }}
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
        One heading per account, and the account names itself. The line under
        it is the bank's own name and number — the same words the Accounts
        screen uses — or the kind of account where there is no bank detail.
      */}
      <SectionHead
        icon={ICONS[group.type] ?? BankIcon}
        title={group.label}
        subtitle={
          [
            // An account named after its bank would print the same words
            // twice, one under the other. Say it once.
            group.bankName !== group.label ? group.bankName : null,
            group.accountNumber,
          ]
            .filter(Boolean)
            .join(" · ") ||
          (ACCOUNT_TYPE_LABELS[group.type] ?? group.type)
        }
        aside={
          editing ? (
            <span className="flex items-center gap-1.5">
              <DotsSixVerticalIcon
                size={18}
                className="text-(--sv-muted)"
                aria-hidden
              />
              {/* Disabled at the ends rather than hidden, so the pair does not
                  shift about as a block travels up the list. */}
              <Handle
                label={`Move ${group.label} up`}
                disabled={first}
                onClick={() => onMove(-1)}
              >
                <ArrowUpIcon weight="bold" size={14} />
              </Handle>
              <Handle
                label={`Move ${group.label} down`}
                disabled={last}
                onClick={() => onMove(1)}
              >
                <ArrowDownIcon weight="bold" size={14} />
              </Handle>
            </span>
          ) : null
        }
      />

      <div className={FIGURE_GRID}>
        {/* "Opening balance", not "Opening bank balance": the heading above
            already says which account this is. */}
        <FigureCard
          href={register}
          icon={ClockCounterClockwiseIcon}
          label="Opening balance"
          {...figures(group.currency, group.opening, group.usd.opening)}
          note={`Carried forward from ${previousMonthName}`}
        />
        <FigureCard
          href={register}
          icon={ArrowDownLeftIcon}
          label="Cash inflow"
          tone="in"
          {...figures(group.currency, group.moneyIn, group.usd.moneyIn)}
          note={shareOf(inflow)}
        />
        <FigureCard
          href={register}
          icon={ArrowUpRightIcon}
          label="Cash outflow"
          tone="out"
          {...figures(group.currency, group.moneyOut, group.usd.moneyOut)}
          note={shareOf(outflow)}
        />
        {/*
          The same figure under two names, and both are accurate. It has always
          been the period's close. On the month in progress that is what the
          account holds right now, so "Current balance" is the honest word;
          looking back at July from August it is what July closed at, and
          calling a two-month-old figure "current" invites somebody to read it
          as today's cash.
        */}
        <FigureCard
          href={register}
          icon={WalletIcon}
          label={ended ? "Closing balance" : "Current balance"}
          {...figures(group.currency, group.closing, group.usd.closing)}
          note={
            ended
              ? "what the month closed at, and what the next opened with"
              : "opening + in − out"
          }
        />
      </div>
    </section>
  );
}

/**
 * The dollar line under a figure: grouped, and marked approximate.
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
 * transaction.
 */
function money(value: string): string {
  return formatMoney(value, { currency: "BDT" });
}

/**
 * Which figure leads, per the account's primary currency.
 *
 * The owner's rule: a USD-primary account states its dollars big and its taka
 * small underneath; a BDT account the reverse. The recorded figure is still
 * the taka either way — the dollars keep their ≈ however large they are
 * printed, and with no rate for the period there is no dollar figure, so a
 * USD-primary block falls back to taka-first rather than leading with a blank.
 * One helper for all four cards, so no card can disagree with its neighbours
 * about which way round the block reads.
 */
function figures(
  currency: string,
  bdt: string,
  usdValue: string | null,
): { value: string; sub: string | null } {
  if (currency === "USD" && usdValue !== null) {
    return { value: usd(usdValue) as string, sub: money(bdt) };
  }
  return { value: money(bdt), sub: usd(usdValue) };
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
      className="sv-button-quiet grid size-8 cursor-pointer place-items-center rounded-lg bg-(--sv-surface) text-(--sv-violet-ink) disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

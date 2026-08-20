"use client";

import { formatCompactMoney } from "@finance/shared";

import { Amount } from "@/components/money/amount";
import { useUsdRate } from "@/components/money/rate-provider";
import { useMoney, useSettings } from "@/components/settings-provider";
import type { ExpenseGroup } from "@/lib/ledger";

/**
 * What one heading spent this month, and where inside it the money went.
 *
 * One panel doing two jobs that used to be two blocks: a thin full-width total
 * strip, and under it a loose cloud of rounded pills. The pills read as
 * decorative tags — nothing about them said they were the sub-categories of
 * the heading whose page this is, and nothing said what clicking one would do.
 * (What it did was navigate to `/expenses/<sub-slug>`, which 404s: that route
 * only resolves top-level headings.)
 *
 * Now they are a filter track welded to the total above them. Picking one
 * re-scopes the big figure and the table below; picking it again, or "All",
 * lets go. The heading label, the stat cluster and the composition bar do not
 * move when a segment is picked — they describe the whole heading for the
 * month, which is the question the page is titled with.
 */

/**
 * One hue per sub-category, at a lightness and chroma that barely move.
 *
 * Not the colour on the category row. Every sub-category in this database
 * inherits its heading's colour — all four of Technology's are `#0d9488` — so
 * a composition bar drawn from stored colours is one solid teal block saying
 * nothing. These differ in hue alone, so no segment shouts louder than
 * another, and past the sixth the wheel is walked in 55° steps at the same
 * lightness rather than reaching for a brighter colour.
 */
const RAMP: ReadonlyArray<readonly [number, number, number]> = [
  [0.82, 0.17, 130],
  [0.78, 0.13, 195],
  [0.75, 0.13, 250],
  [0.75, 0.14, 300],
  [0.78, 0.13, 45],
  [0.8, 0.13, 95],
];

function tone(index: number, alpha?: number): string {
  const [l, c, h] =
    index < RAMP.length
      ? RAMP[index]
      : ([0.78, 0.13, (130 + 55 * index) % 360] as const);
  return alpha === undefined
    ? `oklch(${l} ${c} ${h})`
    : `oklch(${l} ${c} ${h} / ${alpha})`;
}

const plural = (n: number) => `${n} entr${n === 1 ? "y" : "ies"}`;

export function CategorySummaryPanel({
  headingName,
  headingColor,
  rangeLabel,
  total,
  entries,
  groups,
  selectedId,
  onSelect,
}: {
  headingName: string;
  headingColor: string;
  /** "August 2026" — the month, not a range the reader has to decode. */
  rangeLabel: string;
  /** Summed by the server over every matching row, not over a page of them. */
  total: string;
  entries: number;
  /** Sub-categories in descending amount order, as the summary returns them. */
  groups: ExpenseGroup[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const money = useMoney();
  const settings = useSettings();
  const rate = useUsdRate();

  const selected = groups.find((group) => group.id === selectedId) ?? null;
  const shownTotal = selected ? selected.total : total;
  const shownEntries = selected ? selected.entries : entries;
  const shownScope = selected ? selected.name : "all sub-categories";

  /*
   * The dollar line, moved from under the figure into the sub-line beside it.
   *
   * The division is the one `Amount` does for its own second line. It is here
   * rather than there because this figure's typography is the design's — a
   * receding symbol, then the number — and `Amount` right-aligns its
   * counterpart under a figure that is left-aligned in this block. Zero
   * converts to zero, which takes a line to say nothing, so it says nothing.
   */
  const usd =
    rate && Number(shownTotal) !== 0
      ? (Number(shownTotal) / rate).toFixed(2)
      : null;

  const spent = Number(total);
  const shareOf = (value: string) =>
    spent > 0 ? (Number(value) / spent) * 100 : 0;

  const compact = (value: string) =>
    formatCompactMoney(value, {
      currency: settings.baseCurrency,
      format: settings.numberFormat,
    });

  // Display only, and rounded — never a figure anybody reconciles against.
  const average = entries > 0 ? (Number(total) / entries).toFixed(2) : "0.00";

  const segment =
    "flex cursor-pointer flex-col justify-center gap-[7px] rounded-[10px] border px-[15px] py-[11px] text-left transition-[color,background-color,border-color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
  const resting =
    "border-border bg-surface text-muted-foreground hover:border-border-strong hover:bg-surface-muted hover:text-foreground";

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div
        className="flex flex-col border-b border-border-soft"
        style={{
          padding:
            "clamp(18px,2.4vw,26px) clamp(18px,2.4vw,28px) clamp(16px,2vw,22px)",
          gap: "clamp(16px,2vw,20px)",
        }}
      >
        {/* Wraps at around 900px, which puts the stats under the amount
            instead of beside it. No media query does that — the flex does. */}
        <div
          className="flex flex-wrap items-end justify-between"
          style={{ gap: "20px 28px" }}
        >
          <div className="flex min-w-[260px] flex-col gap-2.5">
            <p className="flex items-center gap-2.5 text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
              <span
                aria-hidden
                className="size-[7px] shrink-0 rounded-full"
                style={{ background: headingColor }}
              />
              {headingName} · {rangeLabel}
            </p>

            <p
              className="flex items-baseline gap-2.5"
              style={{ fontSize: "clamp(30px,4.4vw,45px)" }}
            >
              <span
                aria-hidden
                className="text-faint"
                style={{ fontSize: "clamp(19px,2vw,25px)" }}
              >
                ৳
              </span>
              {/* The symbol is drawn beside it rather than inside it, so it
                  can recede. Everything else about the figure — tabular
                  figures, the grouping the company chose — is still the one
                  component that renders money. */}
              <Amount
                value={shownTotal}
                tone="neutral"
                hideSymbol
                showCounterpart={false}
                className="leading-none font-semibold tracking-[-0.02em]"
              />
            </p>

            <p className="flex flex-wrap items-center gap-2.5 text-[13px] text-muted-foreground">
              {usd ? (
                <>
                  <Amount
                    value={usd}
                    currency="USD"
                    approximate
                    tone="neutral"
                    showCounterpart={false}
                    className="text-[13px] font-normal"
                  />
                  <span
                    aria-hidden
                    className="size-[3px] rounded-full bg-border-strong"
                  />
                </>
              ) : null}
              <span>
                <span className="num">{shownEntries}</span> entr
                {shownEntries === 1 ? "y" : "ies"} · {shownScope}
              </span>
            </p>
          </div>

          {groups.length > 0 ? (
            <div
              className="flex flex-wrap pb-1.5"
              style={{ gap: "16px clamp(20px,3vw,34px)" }}
            >
              <Stat
                caption="Sub-categories"
                value={String(groups.length)}
                minWidth={96}
              />
              <Stat
                caption="Avg / entry"
                value={money(average)}
                minWidth={110}
              />
              <Stat
                caption="Top sub-category"
                value={groups[0].name}
                minWidth={120}
              />
            </div>
          ) : null}
        </div>

        {/* Informational only — the reading of it is the track underneath. */}
        {groups.length > 0 && spent > 0 ? (
          <div aria-hidden className="flex h-2 min-w-0 gap-[3px]">
            {groups.map((group, index) => (
              <div
                key={group.id}
                className="rounded-[3px]"
                style={{
                  width: `${shareOf(group.total)}%`,
                  // A sub-category worth 0.06% of the month is a sub-pixel
                  // sliver and draws as nothing at all, which reads as one
                  // fewer sub-category than the count beside it says. Two
                  // pixels is the smallest mark that is still a mark.
                  minWidth: 2,
                  background: tone(index),
                }}
              />
            ))}
          </div>
        ) : null}
      </div>

      {groups.length > 0 ? (
        <div
          role="group"
          aria-label={`Show one sub-category of ${headingName}`}
          // A step off the panel, so the strip reads as a control rather than
          // more of the card. Wraps onto as many rows as it needs — never a
          // sideways scroller, which hides the segment nobody thought to look
          // for.
          className="flex flex-wrap items-stretch gap-2 bg-background"
          style={{
            padding: "clamp(12px,1.5vw,16px) clamp(12px,1.6vw,18px)",
          }}
        >
          <button
            type="button"
            onClick={() => onSelect(null)}
            aria-pressed={selectedId === null}
            className={`${segment} flex-none ${
              selectedId === null
                ? "border-border-strong bg-surface-muted text-foreground"
                : resting
            }`}
          >
            <span className="text-[13px] font-medium">All</span>
            <span className="num text-[11px] opacity-60">
              {plural(entries)}
            </span>
          </button>

          <span aria-hidden className="my-1 w-px flex-none bg-border" />

          {groups.map((group, index) => {
            const on = selectedId === group.id;
            const share = shareOf(group.total);
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => onSelect(on ? null : group.id)}
                aria-pressed={on}
                aria-label={`${group.name}, ${money(group.total)}, ${share.toFixed(1)}% of total`}
                // Shrinks before it wraps, and the name ellipsizes rather
                // than pushing the segment past the panel's edge.
                className={`${segment} max-w-full min-w-0 shrink ${
                  on ? "text-foreground" : resting
                }`}
                style={
                  on
                    ? {
                        borderColor: tone(index, 0.55),
                        background: tone(index, 0.13),
                      }
                    : undefined
                }
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2 flex-none rounded-full"
                    style={{ background: tone(index), opacity: on ? 1 : 0.85 }}
                  />
                  <span className="truncate text-[13px] font-medium">
                    {group.name}
                  </span>
                </span>
                <span className="flex items-baseline gap-2">
                  <span className="num text-[14px] font-semibold whitespace-nowrap">
                    {compact(group.total)}
                  </span>
                  <span className="num text-[10.5px] opacity-60">
                    {share.toFixed(1)}%
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

/** One figure about the whole heading, with its caption above it. */
function Stat({
  caption,
  value,
  minWidth,
}: {
  caption: string;
  value: string;
  minWidth: number;
}) {
  return (
    <div className="flex flex-col items-start gap-[7px]" style={{ minWidth }}>
      <span className="text-[10px] tracking-[0.16em] text-faint uppercase">
        {caption}
      </span>
      <span
        className="num font-semibold text-body"
        style={{ fontSize: "clamp(15px,1.4vw,17px)" }}
      >
        {value}
      </span>
    </div>
  );
}

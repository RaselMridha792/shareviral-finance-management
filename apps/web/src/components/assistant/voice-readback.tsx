"use client";

import { formatMoney, fromMinorUnits } from "@finance/shared";
import { Check, CircleAlert, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";

/* -------------------------------------------------------------------------- */
/*  Finding the figures in a spoken sentence                                   */
/* -------------------------------------------------------------------------- */

/** U+09E6 BENGALI DIGIT ZERO. Recognition in bn-BD returns ৬২০০, not 6200. */
const BENGALI_ZERO = 0x09e6;

function toAsciiDigits(text: string): string {
  return text.replace(/[০-৯]/g, (digit) =>
    String(digit.charCodeAt(0) - BENGALI_ZERO),
  );
}

/**
 * Words that multiply the number in front of them.
 *
 * "cr" is deliberately absent: in a ledger it means credit, and turning
 * "5000 Cr" into five thousand crore would be exactly the kind of confident
 * wrong answer this whole screen exists to prevent.
 */
const SCALES: Record<string, number> = {
  k: 1_000,
  thousand: 1_000,
  thousands: 1_000,
  hazar: 1_000,
  hajar: 1_000,
  হাজার: 1_000,
  lakh: 100_000,
  lakhs: 100_000,
  lac: 100_000,
  lacs: 100_000,
  লাখ: 100_000,
  লক্ষ: 100_000,
  crore: 10_000_000,
  crores: 10_000_000,
  koti: 10_000_000,
  কোটি: 10_000_000,
};

/** A run of digits, then optionally the word that follows it. */
const FIGURE = /(\d[\d,]*(?:\.\d+)?)\s*([A-Za-zঀ-৿]+)?/g;

// This file targets ES2017, where `100n` is a syntax the compiler refuses.
// BigInt() built from a string or a number is the same value.
const TWO = BigInt(2);
const HUNDRED = BigInt(100);

/** Twelve whole digits is what `numeric(14,2)` holds, so 10^14 poisha. */
const TOO_BIG = BigInt("100000000000000");

export type HeardNumber = {
  key: string;
  /** As it appeared in the sentence, e.g. "5 lakh". */
  spoken: string;
  /** Grouped the Bangladeshi way, e.g. "5,00,000". */
  digits: string;
  /** The same figure spelled out, e.g. "five lakh". */
  words: string;
};

/**
 * Every number in a piece of text, in digits and in words.
 *
 * Deliberately generous: a figure that is shown when it did not need to be
 * costs a glance, and a figure that is missed costs an amount in the books.
 * Two things are skipped, because reading them back is noise rather than a
 * check — runs with a leading zero (phone numbers here start 01…, amounts
 * never start with a zero) and anything too long for the ledger to hold.
 */
export function readNumbers(text: string): HeardNumber[] {
  const found: HeardNumber[] = [];
  const seen = new Set<string>();

  for (const match of toAsciiDigits(text).matchAll(FIGURE)) {
    const raw = match[1].replace(/,/g, "").replace(/\.$/, "");
    const word = match[2]?.toLowerCase();
    const scale = word ? SCALES[word] : undefined;

    if (/^0\d/.test(raw)) continue;

    const [whole, fraction = ""] = raw.split(".");
    if (whole.length + fraction.length > 15) continue;

    // Integer arithmetic throughout, in poisha. `0.1 + 0.2` has no place
    // anywhere near an amount somebody is about to confirm.
    const divisor = BigInt(`1${"0".repeat(fraction.length)}`);
    const scaled = BigInt(`${whole}${fraction}`) * BigInt(scale ?? 1);
    const minor = (scaled * HUNDRED + divisor / TWO) / divisor;
    if (minor >= TOO_BIG) continue;

    const amount = fromMinorUnits(minor);
    const [rupees = "0", poisha = "00"] = amount.split(".");
    const key = `${amount}@${match.index}`;
    if (seen.has(amount)) continue;
    seen.add(amount);

    found.push({
      key,
      spoken: scale ? `${match[1]} ${match[2]}` : match[1],
      digits: formatMoney(amount, {
        hideSymbol: true,
        hideDecimals: poisha === "00",
      }),
      words: spellOut(rupees, poisha),
    });
  }

  // Eight is already more figures than a spoken entry ever has; past that the
  // panel stops being a check and becomes a wall.
  return found.slice(0, 8);
}

/* -------------------------------------------------------------------------- */
/*  Numbers, spelled out                                                       */
/* -------------------------------------------------------------------------- */

/*
 * English only, and on purpose.
 *
 * Bangla numerals below a hundred are all irregular — একুশ, বাইশ, তেইশ … — and
 * a read-back that spells one of them wrongly is worse than no read-back at
 * all, because it looks authoritative. The digits half is script-neutral and
 * is what a bank statement here shows anyway.
 *
 * The grouping is Bangladeshi: crore, lakh, thousand, hundred. "Five lakh" is
 * how the figure is said in this country; "five hundred thousand" is not.
 */

const UNITS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];

const TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];

/** 1–99. */
function underHundred(value: number): string {
  if (value < 20) return UNITS[value];
  const ten = TENS[Math.floor(value / 10)];
  const unit = value % 10;
  return unit ? `${ten}-${UNITS[unit]}` : ten;
}

function spellWhole(digits: string): string {
  const value = Number(digits);
  if (!Number.isFinite(value)) return digits;
  if (value === 0) return "zero";

  const parts: string[] = [];
  const crore = Math.floor(value / 10_000_000);
  let rest = value % 10_000_000;

  // Recursive, so "12,345 crore" spells out as well as "5 crore" does. It can
  // only recurse once: a second level would need fifteen digits, and nothing
  // that long gets this far.
  if (crore) parts.push(`${spellWhole(String(crore))} crore`);

  const lakh = Math.floor(rest / 100_000);
  rest %= 100_000;
  if (lakh) parts.push(`${underHundred(lakh)} lakh`);

  const thousand = Math.floor(rest / 1_000);
  rest %= 1_000;
  if (thousand) parts.push(`${underHundred(thousand)} thousand`);

  const hundred = Math.floor(rest / 100);
  rest %= 100;
  if (hundred) parts.push(`${UNITS[hundred]} hundred`);

  if (rest) parts.push(underHundred(rest));

  return parts.join(" ");
}

/**
 * "6200", "50" → "six thousand two hundred point five zero".
 *
 * The decimal is read digit by digit rather than as "fifty", the way an
 * account number is read back — ".05" and ".50" must not be able to sound
 * like one another.
 */
export function spellOut(whole: string, poisha: string): string {
  const words = spellWhole(whole);
  if (poisha === "00") return words;
  const spokenDecimals = poisha
    .split("")
    .map((digit) => UNITS[Number(digit)])
    .join(" ");
  return `${words} point ${spokenDecimals}`;
}

/* -------------------------------------------------------------------------- */
/*  The panel                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What the microphone heard, in digits and in words, above the box.
 *
 * A misheard amount looks exactly like a correct one — "৬,২০০" and "৬২,০০০"
 * differ by a keystroke nobody typed, and by a factor of ten in the books. So
 * a spoken figure does not go anywhere until the person who said it has looked
 * at it twice: once as a number, once as a sentence. The two disagree loudly
 * when the engine has guessed wrong, which is the entire point.
 *
 * It never sends anything itself. Accepting only unlocks the send button.
 */
export function VoiceReadback({
  numbers,
  onAccept,
  onUndo,
}: {
  numbers: HeardNumber[];
  onAccept: () => void;
  onUndo: () => void;
}) {
  if (!numbers.length) return null;

  return (
    <div
      role="group"
      aria-labelledby="voice-readback-title"
      className="mb-2 rounded-xl border border-warning/40 bg-warning/8 px-3.5 py-3 shadow-e1"
    >
      <p
        id="voice-readback-title"
        className="flex items-center gap-1.5 text-xs font-semibold text-warning"
      >
        <CircleAlert className="size-3.5 shrink-0" />
        Check what was heard
      </p>

      <ul className="mt-2 flex flex-col gap-1">
        {numbers.map((number) => (
          <li
            key={number.key}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
          >
            <span className="num text-base font-semibold">{number.digits}</span>
            <span className="text-sm text-muted-foreground">
              {number.words}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        A misheard amount looks exactly like a correct one. If a figure is
        wrong, correct it in the box below — this updates as you type.
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button type="button" variant="primary" size="sm" onClick={onAccept}>
          <Check className="size-3.5" />
          Yes, that is right
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onUndo}>
          <Undo2 className="size-3.5" />
          Undo what I said
        </Button>
      </div>
    </div>
  );
}

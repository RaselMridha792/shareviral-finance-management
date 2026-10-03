import {
  AI_PRICES,
  LONG_PROMPT_TOKENS,
  type Price,
  type Rate,
} from "./ai-prices";

/**
 * Tokens into an estimated cost, exactly (B3, 4 Oct 2026).
 *
 * Money here is never a float sum. Each rate is held as millionths of a
 * dollar per million tokens, a whole number, and every product and sum is a
 * BigInt: a count of 10⁻¹² dollars. Only the total is turned into text, at
 * four places — a turn on Gemini Flash costs a fraction of a cent, and a
 * report of "$0.00" beside a thousand calls would say nothing.
 */

/** Summed counts, as SQL hands them back: one group of calls. */
export type TokenSums = {
  model: string;
  provider: string;
  /** The Dhaka day the calls were made, YYYY-MM-DD: which price applied. */
  day: string;
  /** Whether each call's prompt was over 200,000 tokens. */
  long: boolean;
  calls: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  thinkingTokens: number;
};

/** The price that applied to a model, on a way, on a day — or null. */
export function priceOn(
  model: string,
  provider: string,
  day: string,
): Price | null {
  return (
    AI_PRICES.find(
      (price) =>
        price.model === model &&
        price.provider === provider &&
        (!price.from || day >= price.from) &&
        (!price.until || day <= price.until),
    ) ?? null
  );
}

const MICRO = 1_000_000;
/** USD per million tokens, as whole millionths of a dollar. */
const micro = (usd: number) => BigInt(Math.round(usd * MICRO));

/**
 * What one group cost, in 10⁻¹² dollars: tokens × (millionths of a dollar
 * per million tokens). Null when no price is known for it.
 */
export function picoCost(sums: TokenSums): bigint | null {
  const price = priceOn(sums.model, sums.provider, sums.day);
  if (!price) return null;
  const rate: Rate = sums.long && price.long ? price.long : price.rate;
  // Gemini's thinking is billed as output; Claude's is inside output already
  // and its column is null, summed as 0.
  return (
    BigInt(sums.inputTokens) * micro(rate.input) +
    BigInt(sums.cacheReadTokens) * micro(rate.cacheRead) +
    BigInt(sums.cacheWriteTokens) * micro(rate.cacheWrite) +
    BigInt(sums.outputTokens + sums.thinkingTokens) * micro(rate.output)
  );
}

const PICO_PER_DOLLAR = 10n ** 12n;

/** 10⁻¹² dollars as "12.3456", rounded half up at four places. */
export function dollars(pico: bigint): string {
  const tenThousandths =
    (pico * 10_000n + PICO_PER_DOLLAR / 2n) / PICO_PER_DOLLAR;
  const whole = tenThousandths / 10_000n;
  const part = (tenThousandths % 10_000n).toString().padStart(4, "0");
  return `${whole}.${part}`;
}

/** "30.00" as 10⁻¹² dollars. */
export function picoOf(usd: string): bigint {
  const [whole, part = ""] = usd.split(".");
  return (
    BigInt(whole) * PICO_PER_DOLLAR +
    BigInt((part + "000000000000").slice(0, 12))
  );
}

export { LONG_PROMPT_TOKENS };

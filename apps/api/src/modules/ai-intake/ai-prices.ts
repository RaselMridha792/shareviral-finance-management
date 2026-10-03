import type { AiProvider } from "@finance/shared";

/**
 * What a model call costs, as each provider prices it (B3, 4 Oct 2026).
 *
 * In the code and not in the database, on purpose (#152): the estimate is
 * worked out when it is read, from the tokens `ai_usage` keeps, so a price
 * corrected here corrects every month at once. A stored figure would keep
 * the mistake.
 *
 * Every figure is an ESTIMATE. Each provider's invoice is the real one: it
 * rounds, it may carry a discount or a credit, and Google bills in its own
 * time zone. The report says so beside every figure.
 *
 * Read from the providers' own pages when this was written, not recalled:
 *   - Anthropic: platform.claude.com/docs/en/about-claude/pricing, 4 Oct 2026
 *     — Claude Opus 5: $5 input, $6.25 5-minute cache write, $0.50 cache
 *     hit, $25 output, per million tokens.
 *   - Google: cloud.google.com/vertex-ai/generative-ai/pricing, 4 Oct 2026,
 *     the Global endpoint (the one this app uses unless its region was
 *     changed; a regional one is 10% more). Claude Opus 5 there is priced as
 *     Anthropic prices it. Gemini's output price covers its thinking
 *     ("Text output (response and reasoning)"), and Gemini writes nothing to
 *     a cache here: its caching is implicit.
 *
 * Gemini 3.8 Flash is at an introductory price through 31 December 2026,
 * and Google's standard price from 1 January 2027: both are kept, by date.
 * Gemini 3.1 Pro Preview and 2.5 Pro cost more for a prompt over 200,000
 * tokens: both rates are kept, and a call is priced by its own prompt.
 *
 * A model with no price here is shown with its tokens and "no price known",
 * never as $0.
 */

/** US dollars per million tokens. */
export type Rate = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
};

export type Price = {
  model: string;
  provider: AiProvider;
  /** The first day it applies, YYYY-MM-DD (Dhaka). Absent: always. */
  from?: string;
  /** The last day it applies, YYYY-MM-DD (Dhaka). Absent: still. */
  until?: string;
  /** Up to 200,000 prompt tokens, or every prompt where there is one rate. */
  rate: Rate;
  /** Over 200,000 prompt tokens, where the provider charges more. */
  long?: Rate;
  /** Where the figure was read. */
  source: string;
};

/** A prompt longer than this is priced at the long rate, where there is one. */
export const LONG_PROMPT_TOKENS = 200_000;

const ANTHROPIC_PAGE = "Anthropic's pricing page, 4 Oct 2026";
const GOOGLE_PAGE =
  "Google Cloud's Vertex AI pricing page, Global endpoint, 4 Oct 2026";

const OPUS_5: Rate = { input: 5, cacheRead: 0.5, cacheWrite: 6.25, output: 25 };

export const AI_PRICES: readonly Price[] = [
  {
    model: "claude-opus-5",
    provider: "anthropic",
    rate: OPUS_5,
    source: ANTHROPIC_PAGE,
  },
  {
    model: "claude-opus-5",
    provider: "vertex",
    rate: OPUS_5,
    source: GOOGLE_PAGE,
  },
  {
    model: "gemini-3.8-flash",
    provider: "vertex",
    until: "2026-12-31",
    rate: { input: 0.75, cacheRead: 0.075, cacheWrite: 0, output: 3.75 },
    source: `${GOOGLE_PAGE} (introductory, through 31 Dec 2026)`,
  },
  {
    model: "gemini-3.8-flash",
    provider: "vertex",
    from: "2027-01-01",
    rate: { input: 1.5, cacheRead: 0.15, cacheWrite: 0, output: 7.5 },
    source: `${GOOGLE_PAGE} (standard, from 1 Jan 2027)`,
  },
  {
    model: "gemini-3.1-pro-preview",
    provider: "vertex",
    rate: { input: 2, cacheRead: 0.2, cacheWrite: 0, output: 12 },
    long: { input: 4, cacheRead: 0.4, cacheWrite: 0, output: 18 },
    source: GOOGLE_PAGE,
  },
  {
    model: "gemini-2.5-pro",
    provider: "vertex",
    rate: { input: 1.25, cacheRead: 0.125, cacheWrite: 0, output: 10 },
    long: { input: 2.5, cacheRead: 0.25, cacheWrite: 0, output: 15 },
    source: GOOGLE_PAGE,
  },
];

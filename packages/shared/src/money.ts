/**
 * Money handling.
 *
 * Amounts cross the wire and come out of Drizzle as **strings** (Postgres
 * `numeric(14,2)`), never as JS numbers. `0.1 + 0.2` is the reason: a finance
 * ledger cannot afford binary floating point. Sums and running balances are
 * computed in SQL; this module only parses, validates, and formats.
 */

export type NumberFormat = "bangladeshi" | "western";
export const BDT = "BDT";
export const USD = "USD";

export const CURRENCY_SYMBOLS: Record<string, string> = {
  BDT: "৳",
  USD: "$",
};

/** U+2212 MINUS SIGN — same advance width as `+` in a mono font. */
export const MINUS = "−";
export const PLUS = "+";

/* -------------------------------------------------------------------------- */
/*  Parsing and validation                                                     */
/* -------------------------------------------------------------------------- */

const AMOUNT_PATTERN = /^-?\d{1,12}(\.\d{1,2})?$/;

/** True for a string Postgres will accept as `numeric(14,2)`. */
export function isValidAmount(value: string): boolean {
  return AMOUNT_PATTERN.test(value.trim());
}

/**
 * Amount as an integer count of poisha/cents. Use this for comparisons and
 * import validation — never for storage.
 */
export function toMinorUnits(value: string): bigint {
  const trimmed = value.trim();
  if (!isValidAmount(trimmed)) {
    throw new Error(`Not a valid amount: ${value}`);
  }
  const negative = trimmed.startsWith("-");
  const [whole, fraction = ""] = trimmed.replace("-", "").split(".");
  const paisa = (fraction + "00").slice(0, 2);
  const magnitude = BigInt(whole) * 100n + BigInt(paisa);
  return negative ? -magnitude : magnitude;
}

export function fromMinorUnits(minor: bigint): string {
  const negative = minor < 0n;
  const magnitude = negative ? -minor : minor;
  const whole = magnitude / 100n;
  const paisa = magnitude % 100n;
  return `${negative ? "-" : ""}${whole}.${String(paisa).padStart(2, "0")}`;
}

/** Normalises "1,25,000" or " 4500 " to "125000.00" / "4500.00". */
export function normaliseAmount(input: string): string {
  const stripped = input.replace(/[,\s৳$]/g, "");
  if (!isValidAmount(stripped)) {
    throw new Error(`Not a valid amount: ${input}`);
  }
  return fromMinorUnits(toMinorUnits(stripped));
}

/* -------------------------------------------------------------------------- */
/*  Formatting                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Bangladeshi digit grouping: the last three digits, then pairs.
 * 1250000 → "12,50,000". `Intl` with en-US cannot produce this.
 */
function groupBangladeshi(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const paired = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${paired},${last3}`;
}

function groupWestern(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export type FormatMoneyOptions = {
  currency?: string;
  format?: NumberFormat;
  /** Drop the ".00" — for axis ticks and tiles, not for ledgers. */
  hideDecimals?: boolean;
  /** Force a leading + or −. Colour alone is not an accessible signal. */
  showSign?: boolean;
  /** Omit the ৳ / $ prefix. */
  hideSymbol?: boolean;
};

/**
 * Formats a numeric string for display.
 *
 * Default grouping is Bangladeshi (৳12,50,000) per the user's setting; pass
 * `format: "western"` for ৳1,250,000.
 */
export function formatMoney(
  value: string | number,
  options: FormatMoneyOptions = {},
): string {
  const {
    currency = BDT,
    format = "bangladeshi",
    hideDecimals = false,
    showSign = false,
    hideSymbol = false,
  } = options;

  const raw = typeof value === "number" ? value.toFixed(2) : value.trim();
  const minor = toMinorUnits(raw);
  const negative = minor < 0n;
  const magnitude = negative ? -minor : minor;

  const whole = String(magnitude / 100n);
  const paisa = String(magnitude % 100n).padStart(2, "0");

  /**
   * Lakh–crore grouping belongs to the taka, not to whatever is being shown.
   *
   * The number format is a company preference for how *its own* money reads,
   * and it was applied to every currency: a prepaid card holding $187,083
   * rendered as **$1,87,083.00**, which is not a dollar amount in any locale
   * and reads as a different figure entirely. Every USD value at or above a
   * lakh was affected, and the dollar line now sits under every taka figure on
   * the dashboard.
   *
   * So the setting governs the base currency and nothing else. Anything
   * foreign is grouped the way that currency is written.
   */
  const grouped =
    format === "western" || currency !== BDT
      ? groupWestern(whole)
      : groupBangladeshi(whole);
  const body = hideDecimals ? grouped : `${grouped}.${paisa}`;

  const symbol = hideSymbol
    ? ""
    : (CURRENCY_SYMBOLS[currency] ?? `${currency} `);

  if (showSign) {
    return `${negative ? MINUS : PLUS} ${symbol}${body}`;
  }
  return `${negative ? MINUS : ""}${symbol}${body}`;
}

/**
 * Short form, for an axis tick or a tile where the full figure will not fit.
 *
 * Bangladeshi by default, and that means lakh and crore — not k and M. A
 * finance team here reads "12.5L" instantly and has to convert "1.25M" in
 * their head, which is the opposite of what an abbreviation is for.
 *
 * Never use this where a figure is being checked or reconciled: it rounds, and
 * a rounded amount in a ledger is a wrong amount.
 */
export function formatCompactMoney(
  value: string | number,
  options: FormatMoneyOptions = {},
): string {
  const {
    currency = BDT,
    format = "bangladeshi",
    hideSymbol = false,
  } = options;

  const symbol = hideSymbol
    ? ""
    : (CURRENCY_SYMBOLS[currency] ?? `${currency} `);

  /**
   * A missing figure shows as a dash, not as a thrown error.
   *
   * This used to hand the value to `formatMoney`, which throws on anything it
   * cannot read — so the one branch written to survive a bad value was the one
   * that crashed on it, and an axis tick with no number took the whole chart
   * down. `formatMoney` is right to throw: a ledger figure that cannot be read
   * must not be guessed at. An axis label is not a ledger figure.
   */
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return `${symbol}—`;
  const negative = amount < 0;
  const magnitude = Math.abs(amount);

  const units: Array<[number, string]> =
    format === "western"
      ? [
          [1_000_000_000, "B"],
          [1_000_000, "M"],
          [1_000, "k"],
        ]
      : [
          [10_000_000, "Cr"],
          [100_000, "L"],
          [1_000, "k"],
        ];

  const sign = negative ? MINUS : "";

  for (const [size, suffix] of units) {
    if (magnitude >= size) {
      const scaled = magnitude / size;
      // One decimal below 10, none above — "9.4L" and "12L", never "12.3L",
      // which reads as precision the number does not have.
      const shown =
        scaled < 10 ? scaled.toFixed(1) : Math.round(scaled).toString();
      return `${sign}${symbol}${shown.replace(/\.0$/, "")}${suffix}`;
    }
  }

  return `${sign}${symbol}${Math.round(magnitude)}`;
}

/** Direction-aware sign for the in/out ledger. */
export function signFor(direction: "in" | "out"): string {
  return direction === "in" ? PLUS : MINUS;
}

/**
 * Formats a ledger row: magnitude plus the sign its direction implies.
 * `amount` is always positive in the database.
 */
export function formatLedgerAmount(
  amount: string,
  direction: "in" | "out",
  options: Omit<FormatMoneyOptions, "showSign"> = {},
): string {
  const symbol = options.hideSymbol
    ? ""
    : (CURRENCY_SYMBOLS[options.currency ?? BDT] ??
      `${options.currency ?? BDT} `);
  const body = formatMoney(amount, {
    ...options,
    hideSymbol: true,
    showSign: false,
  });
  return `${signFor(direction)} ${symbol}${body}`;
}

/** Converts using a rate string, rounding half-up to 2 decimals. */
export function convertAmount(amount: string, rate: string): string {
  const amountMinor = toMinorUnits(amount);
  // Rates carry 6 decimals; scale to integer maths to avoid float drift.
  const rateScaled = BigInt(Math.round(Number(rate) * 1_000_000));
  const productScaled = amountMinor * rateScaled; // minor units × 1e6
  const halfUp =
    productScaled >= 0n
      ? (productScaled + 500_000n) / 1_000_000n
      : (productScaled - 500_000n) / 1_000_000n;
  return fromMinorUnits(halfUp);
}

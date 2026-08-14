import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  convertAmount,
  formatCompactMoney,
  formatLedgerAmount,
  formatMoney,
  fromMinorUnits,
  isValidAmount,
  normaliseAmount,
  signFor,
  toMinorUnits,
} from "./money.ts";

describe("toMinorUnits", () => {
  it("converts whole and fractional amounts", () => {
    assert.equal(toMinorUnits("0"), 0n);
    assert.equal(toMinorUnits("45000"), 4_500_000n);
    assert.equal(toMinorUnits("45000.50"), 4_500_050n);
    assert.equal(toMinorUnits("0.05"), 5n);
  });

  it("pads a single decimal place", () => {
    assert.equal(toMinorUnits("12.5"), 1250n);
  });

  it("handles negatives", () => {
    assert.equal(toMinorUnits("-25.75"), -2575n);
  });

  it("rejects junk", () => {
    assert.throws(() => toMinorUnits("12.345"));
    assert.throws(() => toMinorUnits("1,250"));
    assert.throws(() => toMinorUnits("abc"));
  });

  it("survives amounts that would lose precision as a float", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point; in minor units it is exact.
    assert.equal(
      toMinorUnits("0.1") + toMinorUnits("0.2"),
      toMinorUnits("0.3"),
    );
  });
});

describe("fromMinorUnits", () => {
  it("round-trips", () => {
    for (const v of ["0.00", "1.05", "45000.50", "-25.75", "999999.99"]) {
      assert.equal(fromMinorUnits(toMinorUnits(v)), v);
    }
  });

  it("always emits two decimals", () => {
    assert.equal(fromMinorUnits(5n), "0.05");
    assert.equal(fromMinorUnits(100n), "1.00");
  });
});

describe("normaliseAmount", () => {
  it("strips separators, symbols and spaces", () => {
    assert.equal(normaliseAmount("1,25,000"), "125000.00");
    assert.equal(normaliseAmount(" 4500 "), "4500.00");
    assert.equal(normaliseAmount("৳45,000.50"), "45000.50");
  });
});

describe("isValidAmount", () => {
  it("accepts what numeric(14,2) accepts", () => {
    assert.ok(isValidAmount("0"));
    assert.ok(isValidAmount("123456789012.99"));
    assert.ok(!isValidAmount("1234567890123.99")); // 13 integer digits
    assert.ok(!isValidAmount("1.234"));
  });
});

describe("formatMoney — Bangladeshi grouping", () => {
  it("groups the last three digits then in pairs", () => {
    assert.equal(formatMoney("1250000"), "৳12,50,000.00");
    assert.equal(formatMoney("125000"), "৳1,25,000.00");
    assert.equal(formatMoney("45000"), "৳45,000.00");
    assert.equal(formatMoney("1000"), "৳1,000.00");
    assert.equal(formatMoney("999"), "৳999.00");
  });

  it("handles crore-scale numbers", () => {
    assert.equal(formatMoney("25000000"), "৳2,50,00,000.00");
  });
});

describe("formatMoney — western grouping", () => {
  it("groups in threes", () => {
    assert.equal(
      formatMoney("1250000", { format: "western" }),
      "৳1,250,000.00",
    );
    assert.equal(formatMoney("125000", { format: "western" }), "৳125,000.00");
  });
});

describe("formatMoney — options", () => {
  it("uses the USD symbol", () => {
    assert.equal(
      formatMoney("5000", { currency: "USD", format: "western" }),
      "$5,000.00",
    );
  });

  it("can hide decimals and the symbol", () => {
    assert.equal(formatMoney("45000", { hideDecimals: true }), "৳45,000");
    assert.equal(formatMoney("45000", { hideSymbol: true }), "45,000.00");
  });

  it("uses a true minus sign, not a hyphen", () => {
    const out = formatMoney("-45000");
    assert.ok(out.startsWith("−"), `expected U+2212, got ${out}`);
    assert.ok(!out.includes("-"));
  });

  it("shows an explicit sign when asked", () => {
    assert.equal(formatMoney("45000", { showSign: true }), "+ ৳45,000.00");
    assert.equal(formatMoney("-45000", { showSign: true }), "− ৳45,000.00");
  });
});

describe("formatLedgerAmount", () => {
  it("signs by direction, since amounts are stored positive", () => {
    assert.equal(formatLedgerAmount("25000", "in"), "+ ৳25,000.00");
    assert.equal(formatLedgerAmount("25000", "out"), "− ৳25,000.00");
  });
});

describe("convertAmount", () => {
  it("converts USD to BDT at a realised rate", () => {
    assert.equal(convertAmount("5000.00", "118.400000"), "592000.00");
  });

  it("rounds half-up to two decimals", () => {
    assert.equal(convertAmount("1.00", "118.405000"), "118.41");
    assert.equal(convertAmount("1.00", "118.404000"), "118.40");
  });

  it("handles negatives symmetrically", () => {
    assert.equal(convertAmount("-1.00", "118.405000"), "-118.41");
  });
});

/**
 * Lakh–crore grouping belongs to the taka, not to whatever is on screen.
 *
 * The setting is a company preference for how *its own* money reads. Applied
 * to every currency it turned a $187,083 card balance into "$1,87,083.00",
 * which is not a dollar figure in any locale. Every USD value at or above a
 * lakh was wrong, and a dollar line sits under most taka figures.
 */
describe("formatMoney — the grouping setting governs the taka only", () => {
  it("leaves dollars grouped the way dollars are written", () => {
    assert.equal(
      formatMoney("187083", { currency: "USD", format: "bangladeshi" }),
      "$187,083.00",
    );
  });

  it("groups the taka in lakhs at the same moment", () => {
    assert.equal(formatMoney("187083", { format: "bangladeshi" }), "৳1,87,083.00");
  });

  it("holds at a crore of dollars", () => {
    assert.equal(
      formatMoney("25000000", { currency: "USD", format: "bangladeshi" }),
      "$25,000,000.00",
    );
  });

  it("still lets western mode apply to the taka", () => {
    assert.equal(formatMoney("187083", { format: "western" }), "৳187,083.00");
  });
});

describe("formatMoney — edges", () => {
  it("shows zero without a sign", () => {
    assert.equal(formatMoney("0"), "৳0.00");
    assert.equal(formatMoney("0.00"), "৳0.00");
  });

  it("does not invent a minus for negative zero", () => {
    assert.equal(formatMoney("-0.00"), "৳0.00");
  });

  it("keeps the paisa", () => {
    assert.equal(formatMoney("1250000.05"), "৳12,50,000.05");
    assert.equal(formatMoney("0.05"), "৳0.05");
  });

  it("formats the largest amount the column can hold", () => {
    // numeric(14,2) — twelve integer digits, grouped in pairs above the last three.
    assert.equal(formatMoney("999999999999.99"), "৳9,99,99,99,99,999.99");
  });

  it("accepts a number as well as a string", () => {
    assert.equal(formatMoney(45000), "৳45,000.00");
  });

  it("puts the minus before the symbol, not after", () => {
    assert.equal(formatMoney("-1250000"), "−৳12,50,000.00");
  });

  it("hides decimals without losing the grouping", () => {
    assert.equal(formatMoney("1250000", { hideDecimals: true }), "৳12,50,000");
  });
});

/**
 * The short form on chart axes and tiles. A finance team in Dhaka reads "12.5L"
 * at a glance and has to convert "1.25M" in their head — which is the opposite
 * of what an abbreviation is for.
 */
describe("formatCompactMoney", () => {
  it("abbreviates in lakh and crore by default", () => {
    assert.equal(formatCompactMoney("1250000"), "৳13L"); // 12.5 rounds up
    assert.equal(formatCompactMoney("940000"), "৳9.4L");
    assert.equal(formatCompactMoney("25000000"), "৳2.5Cr");
    assert.equal(formatCompactMoney("100000"), "৳1L");
  });

  it("abbreviates in k below a lakh", () => {
    assert.equal(formatCompactMoney("45000"), "৳45k");
    assert.equal(formatCompactMoney("1500"), "৳1.5k");
  });

  it("leaves small numbers alone", () => {
    assert.equal(formatCompactMoney("999"), "৳999");
    assert.equal(formatCompactMoney("0"), "৳0");
  });

  it("switches to k/M/B in western mode", () => {
    assert.equal(formatCompactMoney("1250000", { format: "western" }), "৳1.3M");
    assert.equal(formatCompactMoney("25000000", { format: "western" }), "৳25M");
  });

  it("drops a trailing .0 rather than showing 12.0L", () => {
    assert.equal(formatCompactMoney("1000000"), "৳10L");
  });

  it("shows one decimal below ten and none above — never false precision", () => {
    assert.equal(formatCompactMoney("1230000"), "৳12L");
    assert.equal(formatCompactMoney("930000"), "৳9.3L");
  });

  it("uses a true minus sign here too", () => {
    const out = formatCompactMoney("-1250000");
    assert.ok(out.startsWith("−"), `expected U+2212, got ${out}`);
    assert.ok(!out.includes("-"));
  });

  it("keeps dollars in dollars", () => {
    assert.equal(formatCompactMoney("1250000", { currency: "USD" }), "$13L");
  });

  it("shows a dash for a missing figure instead of throwing", () => {
    // An axis tick is not a ledger figure; it must not take the chart down.
    assert.equal(formatCompactMoney("not a number"), "৳—");
    assert.equal(formatCompactMoney(undefined), "৳—");
    assert.equal(formatCompactMoney(NaN, { currency: "USD" }), "$—");
  });
});

describe("signFor", () => {
  it("is a plus for money in and a true minus for money out", () => {
    assert.equal(signFor("in"), "+");
    assert.equal(signFor("out"), "−");
    assert.ok(!signFor("out").includes("-"));
  });
});

describe("formatLedgerAmount — with options", () => {
  it("carries the currency and the grouping setting", () => {
    assert.equal(
      formatLedgerAmount("187083", "out", { currency: "USD" }),
      "− $187,083.00",
    );
    assert.equal(formatLedgerAmount("1250000", "in"), "+ ৳12,50,000.00");
  });

  it("can drop the symbol for a column that carries its own", () => {
    assert.equal(
      formatLedgerAmount("45000", "out", { hideSymbol: true }),
      "− 45,000.00",
    );
  });

  it("signs by direction even for zero", () => {
    assert.equal(formatLedgerAmount("0", "out"), "− ৳0.00");
  });
});

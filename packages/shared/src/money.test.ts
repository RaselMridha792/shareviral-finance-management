import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  convertAmount,
  formatLedgerAmount,
  formatMoney,
  fromMinorUnits,
  isValidAmount,
  normaliseAmount,
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

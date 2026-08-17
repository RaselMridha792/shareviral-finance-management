import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  exportSubscriptionsQuerySchema,
  subscriptionsQuerySchema,
} from "./masters.ts";
import { wasPaidInPeriod, type SubscriptionLine } from "./subscriptions.ts";

const line = (paidThisPeriod: string): SubscriptionLine => ({
  id: "1",
  name: "Claude",
  type: "ai_tool",
  billingCycle: "monthly",
  billingAmount: "20.00",
  billingCurrency: "USD",
  paidThisPeriod,
  entriesThisPeriod: 0,
  lastPaidOn: null,
  billingAccountId: null,
  billingAccountName: null,
});

describe("wasPaidInPeriod", () => {
  it("is true only when money actually moved", () => {
    assert.equal(wasPaidInPeriod(line("2400.00")), true);
    assert.equal(wasPaidInPeriod(line("0.01")), true);
  });

  it("reads Postgres's zero as not bought, not as bought", () => {
    // A numeric(14,2) sum with nothing to sum comes back as the string
    // "0.00", which is truthy. Compared as a string, every tool would show as
    // paid this month and the screen would answer its one question wrongly.
    assert.equal(wasPaidInPeriod(line("0.00")), false);
    assert.equal(wasPaidInPeriod(line("0")), false);
  });

  it("does not treat a missing figure as a payment", () => {
    assert.equal(wasPaidInPeriod(line("")), false);
    assert.equal(wasPaidInPeriod(line("not a number")), false);
  });
});

describe("which month the figures cover", () => {
  it("means this month when nothing is asked for", () => {
    const parsed = subscriptionsQuerySchema.parse({});
    assert.equal(parsed.year, undefined);
    assert.equal(parsed.month, undefined);
  });

  it("takes a year and a month from the query string", () => {
    // Arrives as text on a URL, so the coercion is the part worth asserting.
    const parsed = subscriptionsQuerySchema.parse({ year: "2026", month: "6" });
    assert.equal(parsed.year, 2026);
    assert.equal(parsed.month, 6);
  });

  it("refuses a year without a month, and a month without a year", () => {
    // Half a period is the dangerous case. A year alone would have to mean
    // some month, and whichever one the server picked would be a guess made on
    // the caller's behalf about money — so it is refused rather than guessed.
    assert.equal(subscriptionsQuerySchema.safeParse({ year: 2026 }).success, false);
    assert.equal(subscriptionsQuerySchema.safeParse({ month: 6 }).success, false);
  });

  it("refuses a month outside 1–12", () => {
    assert.equal(
      subscriptionsQuerySchema.safeParse({ year: 2026, month: 0 }).success,
      false,
    );
    assert.equal(
      subscriptionsQuerySchema.safeParse({ year: 2026, month: 13 }).success,
      false,
    );
  });

  it("does not judge the future here", () => {
    // Deliberately accepted by the schema: whether a month has happened depends
    // on the clock, and a schema that reads today's date is a schema whose
    // tests break in September. The service checks it against Dhaka time.
    assert.equal(
      subscriptionsQuerySchema.safeParse({ year: 2099, month: 12 }).success,
      true,
    );
  });

  it("carries the screen's filters into the export", () => {
    const parsed = exportSubscriptionsQuerySchema.parse({
      year: "2026",
      month: "6",
      q: "  claude  ",
      includeInactive: "true",
    });
    assert.equal(parsed.q, "claude");
    assert.equal(parsed.includeInactive, true);
    // A cancelled tool still cost money in the month it was cancelled, so the
    // export follows the screen, which asks for the inactive ones too.
    assert.equal(
      exportSubscriptionsQuerySchema.parse({}).includeInactive,
      false,
    );
  });
});

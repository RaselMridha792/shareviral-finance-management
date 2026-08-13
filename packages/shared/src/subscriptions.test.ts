import assert from "node:assert/strict";
import { describe, it } from "node:test";

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

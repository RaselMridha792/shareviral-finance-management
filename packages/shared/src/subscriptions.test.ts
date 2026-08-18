import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  exportSubscriptionsQuerySchema,
  subscriptionsQuerySchema,
} from "./masters.ts";
import {
  costsAgree,
  createSubscriptionSchema,
  deriveCost,
  updateSubscriptionSchema,
  wasPaidInPeriod,
  type SubscriptionLine,
} from "./subscriptions.ts";

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

/* -------------------------------------------------------------------------- */
/*  The three money fields                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The rule these guard is the reason the form exists in the shape it does.
 *
 * The company's bills arrive in dollars and in taka and they want both stored.
 * A form that accepted three independent numbers is exactly how the Cash In
 * sheet came to hold a row whose rate disagrees with its own amounts by
 * ৳27,612 — with nothing in the file to say which of the three is wrong, and
 * therefore no way to correct it later.
 */
describe("deriveCost", () => {
  it("works out the taka from the dollars and the rate", () => {
    assert.equal(
      deriveCost({ costUsd: "20.00", usdRate: "122.50" }).costBdt,
      "2450.00",
    );
  });

  it("works out the rate from the two prices", () => {
    assert.equal(
      deriveCost({ costUsd: "20.00", costBdt: "2450.00" }).usdRate,
      "122.500000",
    );
  });

  it("works out the dollars from the taka and the rate", () => {
    assert.equal(
      deriveCost({ costBdt: "2450.00", usdRate: "122.50" }).costUsd,
      "20.00",
    );
  });

  it("leaves a complete triple exactly as it is", () => {
    const triple = { costUsd: "20.00", costBdt: "2450.00", usdRate: "122.50" };
    assert.deepEqual(deriveCost(triple), triple);
  });

  it("leaves a single figure alone — one is not two", () => {
    assert.deepEqual(deriveCost({ costUsd: "20.00" }), { costUsd: "20.00" });
    assert.deepEqual(deriveCost({}), {});
  });

  it("does not divide by zero to find a rate", () => {
    assert.equal(deriveCost({ costUsd: "0", costBdt: "2450.00" }).usdRate, undefined);
  });

  it("does not divide by a zero rate to find a price", () => {
    assert.equal(
      deriveCost({ costBdt: "2450.00", usdRate: "0" }).costUsd,
      undefined,
    );
  });

  it("treats an empty string as nothing typed, not as zero", () => {
    // The form's fields start empty, so this is the state it spends most of
    // its life in. Reading "" as 0 would derive a rate of 0 from a blank taka
    // box and put it on screen as a figure somebody had entered.
    //
    // Nothing is invented from one figure — what came in comes back untouched,
    // empty box and all…
    assert.equal(deriveCost({ costUsd: "20.00", costBdt: "" }).costBdt, "");
    assert.equal(deriveCost({ costUsd: "20.00", costBdt: "" }).usdRate, undefined);

    // …and once there are two real figures, the empty one is the hole to fill.
    assert.equal(
      deriveCost({ costUsd: "20.00", costBdt: "", usdRate: "122.50" }).costBdt,
      "2450.00",
    );
  });
});

describe("costsAgree", () => {
  it("accepts a triple that ties out", () => {
    assert.equal(
      costsAgree({ costUsd: "20.00", costBdt: "2450.00", usdRate: "122.50" }),
      true,
    );
  });

  it("refuses a triple where one of the three is wrong", () => {
    assert.equal(
      costsAgree({ costUsd: "3000.00", costBdt: "340000.00", usdRate: "122.50" }),
      false,
    );
  });

  it("allows a paisa of rounding, and no more", () => {
    // The rate is kept to six places and the amounts to two, so an exact
    // product can still land half a paisa out once both ends are rounded.
    assert.equal(
      costsAgree({ costUsd: "19.99", costBdt: "2447.91", usdRate: "122.4567" }),
      true,
    );
    assert.equal(
      costsAgree({ costUsd: "19.99", costBdt: "2448.20", usdRate: "122.4567" }),
      false,
    );
  });

  it("says nothing about an incomplete triple", () => {
    // A check on three figures, not a requirement that three exist.
    assert.equal(costsAgree({ costUsd: "20.00" }), true);
    assert.equal(costsAgree({ costUsd: "20.00", costBdt: "2450.00" }), true);
    assert.equal(costsAgree({}), true);
    assert.equal(
      costsAgree({ costUsd: "20.00", costBdt: null, usdRate: null }),
      true,
    );
  });

  it("holds for everything deriveCost produces", () => {
    for (const input of [
      { costUsd: "20.00", usdRate: "122.50" },
      { costUsd: "130.00", usdRate: "121.9034" },
      { costBdt: "48761.36", usdRate: "121.9034" },
      { costUsd: "0.99", usdRate: "122.4567" },
    ]) {
      assert.equal(
        costsAgree(deriveCost(input)),
        true,
        `derived from ${JSON.stringify(input)}`,
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  What the register accepts                                                  */
/* -------------------------------------------------------------------------- */

const plan = {
  vendorId: "11111111-1111-4111-8111-111111111111",
  planName: "Max Plan 5x",
  category: "ai_tool" as const,
  costUsd: "100.00",
  startDate: "2026-01-15",
};

describe("creating a subscription", () => {
  it("takes the least it can be given", () => {
    const parsed = createSubscriptionSchema.safeParse(plan);
    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
    assert.equal(parsed.data?.status, "active");
    assert.equal(parsed.data?.billingCycle, "monthly");
    assert.deepEqual(parsed.data?.users, []);
  });

  it("refuses a triple that does not tie out", () => {
    const parsed = createSubscriptionSchema.safeParse({
      ...plan,
      costBdt: "1000.00",
      usdRate: "122.50",
    });
    assert.equal(parsed.success, false);
    assert.equal(parsed.error?.issues[0]?.path[0], "costBdt");
  });

  it("takes a note where a date will not go", () => {
    // The sheet has a row reading "Credit base" where a date belongs. Forcing
    // one there produces either a wrong date or a lost row.
    const parsed = createSubscriptionSchema.safeParse({
      ...plan,
      nextRenewalOn: "",
      renewalNote: "Credit base",
    });
    assert.equal(parsed.success, true);
    assert.equal(parsed.data?.nextRenewalOn, undefined);
    assert.equal(parsed.data?.renewalNote, "Credit base");
  });

  it("refuses a renewal before the plan started", () => {
    const parsed = createSubscriptionSchema.safeParse({
      ...plan,
      nextRenewalOn: "2025-12-01",
    });
    assert.equal(parsed.success, false);
    assert.equal(parsed.error?.issues[0]?.path[0], "nextRenewalOn");
  });

  it("refuses the same person twice on one plan", () => {
    const seat = { teamMemberId: "22222222-2222-4222-8222-222222222222" };
    const parsed = createSubscriptionSchema.safeParse({
      ...plan,
      users: [seat, { ...seat, status: "canceled" }],
    });
    assert.equal(parsed.success, false);
    assert.equal(parsed.error?.issues[0]?.path[0], "users");
  });

  it("gives each seat its own status, defaulting to active", () => {
    const parsed = createSubscriptionSchema.safeParse({
      ...plan,
      users: [
        { teamMemberId: "22222222-2222-4222-8222-222222222222" },
        {
          teamMemberId: "33333333-3333-4333-8333-333333333333",
          status: "canceled",
          untilDate: "2026-07-31",
        },
      ],
    });
    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
    // A plan can be perfectly active while one person's access to it ended.
    assert.equal(parsed.data?.users[0].status, "active");
    assert.equal(parsed.data?.users[1].status, "canceled");
  });

  it("refuses a field nobody defined", () => {
    assert.equal(
      createSubscriptionSchema.safeParse({ ...plan, seats: 13 }).success,
      false,
    );
  });
});

describe("changing a subscription", () => {
  /**
   * Why `patchOf` and not `.partial()`: Zod keeps a `.default()` inside the
   * now-optional field and materialises it on an absent key, so a body
   * changing only the plan name would also write `status: "active"` and
   * `billingCycle: "monthly"` — reviving a cancelled subscription as a side
   * effect of fixing a typo.
   */
  it("writes only what was sent", () => {
    const parsed = updateSubscriptionSchema.safeParse({ planName: "Max 20x" });
    assert.equal(parsed.success, true);
    assert.deepEqual(Object.keys(parsed.data ?? {}), ["planName"]);
  });

  it("refuses a body that changes nothing", () => {
    assert.equal(updateSubscriptionSchema.safeParse({}).success, false);
  });

  it("still refuses a triple that does not tie out", () => {
    assert.equal(
      updateSubscriptionSchema.safeParse({
        costUsd: "100.00",
        costBdt: "1.00",
        usdRate: "122.50",
      }).success,
      false,
    );
  });

  /**
   * An empty list is a real instruction — "nobody is on this now" — and has to
   * survive as one. Absent means leave the seats alone; the two must not
   * collapse into each other on the way through.
   */
  it("tells an empty seat list apart from an absent one", () => {
    const cleared = updateSubscriptionSchema.safeParse({ users: [] });
    assert.equal(cleared.success, true);
    assert.deepEqual(cleared.data?.users, []);

    const untouched = updateSubscriptionSchema.safeParse({ planName: "x" });
    assert.equal(untouched.success, true);
    assert.equal("users" in (untouched.data ?? {}), false);
  });
});

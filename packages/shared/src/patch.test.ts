import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createAccountSchema, updateAccountSchema } from "./masters.ts";
import { updateTeamMemberSchema } from "./payroll.ts";

/**
 * What a PATCH may and may not write.
 *
 * This is the schema behind three bugs that all wrote money nobody asked them
 * to: an account's opening balance zeroed by a request that only renamed it, a
 * contractor turned into an employee by the Change status dialog, a
 * USD 3,000 subscription reset to BDT 3,000. In every case the audit trail
 * recorded the change faithfully — it was simply never requested.
 *
 * The rule is one sentence: what is not in the body must not reach the
 * database, and an explicit null must.
 */

describe("an absent key stays absent", () => {
  it("does not materialise a default the caller never sent", () => {
    // `createAccountSchema.openingBalance` defaults to "0". Under
    // `.partial()` that default survives and lands in the parsed object, so a
    // rename would carry an opening balance of zero into the SET clause.
    const parsed = updateAccountSchema.parse({ name: "City Bank" });

    assert.deepEqual(Object.keys(parsed), ["name"]);
    assert.ok(!("openingBalance" in parsed));
    assert.ok(!("currency" in parsed));
  });

  it("still applies the defaults on a create, where they belong", () => {
    const created = createAccountSchema.parse({
      name: "Petty cash",
      type: "cash",
      openingBalanceOn: "2026-06-30",
    });
    assert.equal(created.openingBalance, "0");
  });

  it("refuses a body with nothing in it", () => {
    assert.equal(updateAccountSchema.safeParse({}).success, false);
  });
});

describe("bringing somebody back", () => {
  /**
   * Resigned on the 30th, back on the 5th.
   *
   * In a PATCH `undefined` means "leave it alone", so without an explicit null
   * there is no way to say "they have no last day any more". The record would
   * read as somebody who left and is still employed, and the Team screen would
   * show a leaving date beside the word Working.
   */
  it("keeps an explicit null so the last day can be cleared", () => {
    const parsed = updateTeamMemberSchema.parse({
      status: "active",
      endedOn: null,
    });

    assert.ok("endedOn" in parsed, "endedOn must survive the parse");
    assert.equal(parsed.endedOn, null);
  });

  it("treats an emptied date input the same as a null", () => {
    // What a cleared <input type="date"> actually submits.
    const parsed = updateTeamMemberSchema.parse({
      status: "active",
      endedOn: "",
    });
    assert.equal(parsed.endedOn, null);
  });

  it("keeps a real last day when somebody does leave", () => {
    const parsed = updateTeamMemberSchema.parse({
      status: "resigned",
      endedOn: "2026-08-30",
    });
    assert.equal(parsed.endedOn, "2026-08-30");
  });

  it("leaves the last day alone when the key is not sent", () => {
    const parsed = updateTeamMemberSchema.parse({ designation: "Tech Lead" });
    assert.ok(!("endedOn" in parsed));
    assert.ok(!("status" in parsed));
    // The one that turned a contractor into an employee.
    assert.ok(!("engagementType" in parsed));
  });
});

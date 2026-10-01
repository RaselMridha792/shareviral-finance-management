import { sheetNotice, type ReachedSheet } from "./sheet-notice";

/**
 * The sentence the CFO reads after approving a pay change (#128): said from
 * what each sheet it reaches holds for that person, and from what the
 * sheet's state still allows.
 */

const sheet = (
  label: string,
  status: string,
  gross: string | null,
  workingDays: number | null = null,
): ReachedSheet => ({ label, status, gross, workingDays });

describe("sheetNotice", () => {
  it("says nothing when no sheet is reached, or every one already holds this figure", () => {
    expect(sheetNotice([], "60000.00")).toBeNull();
    expect(
      sheetNotice(
        [
          sheet("May 2026", "paid", "60000.00"),
          sheet("June 2026", "draft", "60000"),
        ],
        "60000.00",
      ),
    ).toBeNull();
  });

  it("a draft: built at what it holds, or without them, and Build list", () => {
    expect(
      sheetNotice([sheet("June 2026", "draft", "50000.00")], "60000.00"),
    ).toBe(
      "June 2026 was built at ৳50,000.00 for them — press Build list on it to use this figure.",
    );
    expect(sheetNotice([sheet("June 2026", "draft", null)], "60000.00")).toBe(
      "June 2026 was built without them on it — press Build list on it to use this figure.",
    );
  });

  it("finalised is not paid: reopen while the money has not gone, whichever way the figure moves", () => {
    for (const asked of ["40000.00", "60000.00"]) {
      expect(
        sheetNotice([sheet("June 2026", "finalized", "50000.00")], asked),
      ).toBe(
        "June 2026 is finalised at ৳50,000.00 for them but not marked paid — if the money has not gone to the bank yet, reopen it and press Build list to use this figure.",
      );
    }
  });

  it("paid at less: what more is owed waits for a one-off", () => {
    expect(
      sheetNotice([sheet("June 2026", "paid", "50000.00")], "60000.00"),
    ).toBe(
      "June 2026 is already paid at ৳50,000.00 for them; anything more owed for that month is not paid unless HR sends it as a one-off.",
    );
  });

  it("paid at more: an overpayment, which a one-off cannot take back", () => {
    expect(
      sheetNotice([sheet("June 2026", "paid", "60000.00")], "55000.00"),
    ).toBe(
      "June 2026 is already paid at ৳60,000.00 for them, more than this figure; nothing takes an overpayment back on its own, and a one-off can only add pay.",
    );
  });

  it("paid without them: the whole month is owed", () => {
    expect(sheetNotice([sheet("June 2026", "paid", null)], "60000.00")).toBe(
      "June 2026 is already paid without them on it; what is owed for that month is not paid unless HR sends it as a one-off.",
    );
  });

  it("a line cut to days worked is said as such, and never read as already at this figure", () => {
    expect(
      sheetNotice([sheet("June 2026", "paid", "60000.00", 18)], "60000.00"),
    ).toBe(
      "June 2026 is already paid at ৳60,000.00 for them (18 days worked); anything more owed for that month is not paid unless HR sends it as a one-off.",
    );
  });

  it("sheets holding the same thing are named together, in order; the rest on their own", () => {
    expect(
      sheetNotice(
        [
          sheet("March 2026", "paid", "50000.00"),
          sheet("April 2026", "paid", "50000.00"),
          sheet("May 2026", "paid", "60000.00"),
          sheet("June 2026", "finalized", "50000.00"),
          sheet("July 2026", "draft", "50000.00"),
          sheet("August 2026", "draft", "50000.00"),
        ],
        "60000.00",
      ),
    ).toBe(
      [
        "March 2026, April 2026 are already paid at ৳50,000.00 for them; anything more owed for those months is not paid unless HR sends it as a one-off.",
        "June 2026 is finalised at ৳50,000.00 for them but not marked paid — if the money has not gone to the bank yet, reopen it and press Build list to use this figure.",
        "July 2026, August 2026 were built at ৳50,000.00 for them — press Build list on each to use this figure.",
      ].join(" "),
    );
  });

  it("a partly paid sheet is treated as paid", () => {
    expect(
      sheetNotice(
        [sheet("June 2026", "partially_paid", "50000.00")],
        "60000.00",
      ),
    ).toMatch(/^June 2026 is already paid at/);
  });
});

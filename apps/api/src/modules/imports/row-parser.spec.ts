import { parseAmount, parseDate, parseRow } from "./row-parser";

describe("parseAmount", () => {
  it("reads plain numbers", () => {
    expect(parseAmount("4500")).toBe("4500.00");
    expect(parseAmount("4500.5")).toBe("4500.50");
  });

  it("strips thousands separators and currency symbols", () => {
    expect(parseAmount("1,25,000.50")).toBe("125000.50");
    expect(parseAmount("৳ 25,000")).toBe("25000.00");
    expect(parseAmount("$1,250.00")).toBe("1250.00");
  });

  it("reads accounting parentheses as negative", () => {
    expect(parseAmount("(4,500)")).toBe("-4500.00");
    expect(parseAmount("-4500")).toBe("-4500.00");
  });

  it("treats a trailing comma group of two as a decimal comma", () => {
    // European style: 4500,50 means four and a half thousand.
    expect(parseAmount("4500,50")).toBe("4500.50");
  });

  it("rejects text that is not an amount", () => {
    expect(parseAmount("")).toBeUndefined();
    expect(parseAmount("n/a")).toBeUndefined();
    expect(parseAmount("12.34.56")).toBeUndefined();
  });
});

describe("parseDate", () => {
  it("passes ISO through", () => {
    expect(parseDate("2026-08-05", "auto")).toBe("2026-08-05");
    expect(parseDate("2026-08-05T00:00:00.000Z", "auto")).toBe("2026-08-05");
  });

  it("respects the stated order for an ambiguous date", () => {
    // The whole reason the format is asked for rather than guessed.
    expect(parseDate("05/08/2026", "dmy")).toBe("2026-08-05");
    expect(parseDate("05/08/2026", "mdy")).toBe("2026-05-08");
  });

  it("accepts several separators", () => {
    expect(parseDate("05-08-2026", "dmy")).toBe("2026-08-05");
    expect(parseDate("05.08.2026", "dmy")).toBe("2026-08-05");
  });

  it("uses an impossible month to disambiguate in auto mode", () => {
    expect(parseDate("25/08/2026", "auto")).toBe("2026-08-25");
    expect(parseDate("08/25/2026", "auto")).toBe("2026-08-25");
  });

  it("defaults to day-first in auto mode, as Bangladesh writes it", () => {
    expect(parseDate("05/08/2026", "auto")).toBe("2026-08-05");
  });

  it("expands two-digit years", () => {
    expect(parseDate("05/08/26", "dmy")).toBe("2026-08-05");
  });

  it("reads Excel serial numbers", () => {
    // 46239 is 2026-08-05 in Excel's day count.
    expect(parseDate("46239", "auto")).toBe("2026-08-05");
  });

  it("rejects impossible dates", () => {
    expect(parseDate("32/08/2026", "dmy")).toBeUndefined();
    expect(parseDate("29/02/2026", "dmy")).toBeUndefined(); // 2026 is not a leap year
    expect(parseDate("29/02/2028", "dmy")).toBe("2028-02-29"); // 2028 is
    expect(parseDate("not a date", "auto")).toBeUndefined();
  });
});

describe("parseRow", () => {
  const map = {
    Date: "txnDate" as const,
    Particulars: "description" as const,
    Debit: "amountOut" as const,
    Credit: "amountIn" as const,
  };
  const defaults = { dateFormat: "dmy" as const };

  it("reads a row with separate in and out columns", () => {
    const result = parseRow(
      {
        Date: "05/08/2026",
        Particulars: "Office rent",
        Debit: "25,000",
        Credit: "",
      },
      map,
      defaults,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row).toMatchObject({
        txnDate: "2026-08-05",
        description: "Office rent",
        amount: "25000.00",
        direction: "out",
      });
    }
  });

  it("reads the credit column as money in", () => {
    const result = parseRow(
      {
        Date: "02/08/2026",
        Particulars: "Funding",
        Debit: "",
        Credit: "592000",
      },
      map,
      defaults,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.direction).toBe("in");
  });

  it("refuses a row with both columns filled", () => {
    const result = parseRow(
      { Date: "02/08/2026", Particulars: "Odd", Debit: "10", Credit: "20" },
      map,
      defaults,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toMatch(/both/i);
    }
  });

  it("takes the direction from a negative sign on a single column", () => {
    const result = parseRow(
      { Date: "05/08/2026", Details: "Rent", Amount: "-25000" },
      { Date: "txnDate", Details: "description", Amount: "amount" },
      defaults,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.direction).toBe("out");
      expect(result.row.amount).toBe("25000.00");
    }
  });

  it("refuses to guess direction from an unsigned single column", () => {
    // Guessing here would silently reverse a whole month of figures.
    const result = parseRow(
      { Date: "05/08/2026", Details: "Rent", Amount: "25000" },
      { Date: "txnDate", Details: "description", Amount: "amount" },
      defaults,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/direction/i);
  });

  it("uses the stated assumption when there is one", () => {
    const result = parseRow(
      { Date: "05/08/2026", Details: "Rent", Amount: "25000" },
      { Date: "txnDate", Details: "description", Amount: "amount" },
      { ...defaults, assumeDirection: "out" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.direction).toBe("out");
  });

  it("reads a direction word", () => {
    for (const [word, expected] of [
      ["Cr", "in"],
      ["credit", "in"],
      ["DR", "out"],
      ["Debit", "out"],
    ] as const) {
      const result = parseRow(
        { Date: "05/08/2026", Details: "X", Amount: "100", Type: word },
        {
          Date: "txnDate",
          Details: "description",
          Amount: "amount",
          Type: "direction",
        },
        defaults,
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.row.direction).toBe(expected);
    }
  });

  it("collects every problem at once rather than stopping at the first", () => {
    const result = parseRow({ Date: "", Particulars: "" }, map, defaults);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

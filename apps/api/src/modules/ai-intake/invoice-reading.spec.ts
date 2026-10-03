/**
 * A plan's invoice, read for its number (4 Oct 2026). What comes back from
 * the model is held to its shape: a number too long for the plan, a date
 * that is not one, a total with words in it, are read as not printed and
 * asked about rather than kept.
 */
import type { DocumentRequest, TurnModel } from "./model-turn";
import { invoiceReadingOf, readInvoicePaper } from "./invoice-reading";

describe("what was read off an invoice", () => {
  it("keeps what is printed, as printed", () => {
    expect(
      invoiceReadingOf({
        isInvoice: true,
        number: " INV-2026-0042 ",
        date: "2026-10-03",
        seller: "Anthropic, PBC",
        total: "1,100.00",
        currency: "usd",
      }),
    ).toEqual({
      number: "INV-2026-0042",
      date: "2026-10-03",
      seller: "Anthropic, PBC",
      total: "1100.00",
      currency: "USD",
    });
  });

  it("reads anything not in the shape as not printed", () => {
    expect(
      invoiceReadingOf({
        number: "x".repeat(61),
        date: "3 Oct 2026",
        total: "about 100",
        currency: "dollars",
        seller: 42,
      }),
    ).toEqual({
      number: null,
      date: null,
      seller: null,
      total: null,
      currency: null,
    });
    expect(invoiceReadingOf(null).number).toBeNull();
    expect(invoiceReadingOf("INV-1").number).toBeNull();
  });

  it("hands the model the picture as a picture", async () => {
    const asked: DocumentRequest[] = [];
    const model: TurnModel = {
      converse: () => {
        throw new Error("not a turn");
      },
      readDocument: (request) => {
        asked.push(request);
        return Promise.resolve({
          input: { isInvoice: true, number: "A-7" },
          truncated: false,
        });
      },
    };
    const read = await readInvoicePaper(
      model,
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      "image/png",
    );
    expect(read.number).toBe("A-7");
    expect(asked[0].mimeType).toBe("image/png");
    expect(asked[0].tool.name).toBe("invoice_fields");
  });
});

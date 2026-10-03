/**
 * A workbook read whole, a sheet at a time, for the Assistant (A3c); and the
 * Import screen's reader, which still takes the first sheet alone.
 */
import ExcelJS from "exceljs";

import { readSpreadsheet, readWorkbook } from "./spreadsheet";

/** A workbook's bytes, its sheets as given: a name, rows, and a state. */
async function workbook(
  sheets: {
    name: string;
    rows: unknown[][];
    state?: "visible" | "hidden" | "veryHidden";
  }[],
): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const added = book.addWorksheet(sheet.name, {
      state: sheet.state ?? "visible",
    });
    for (const row of sheet.rows) added.addRow(row);
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

const MIXED = [
  {
    name: "Payments",
    rows: [
      ["Date", "Paid to", "Amount"],
      ["03/09/2026", "Hostinger", 4500],
      [],
      ["09/09/2026", "Courier", 640],
    ],
  },
  {
    name: "People",
    rows: [
      ["Name", "Salary"],
      ["Rahim", 45000],
    ],
  },
  { name: "Notes", rows: [], state: "hidden" as const },
  {
    name: "Lookup",
    rows: [["Code"], ["A1"]],
    state: "veryHidden" as const,
  },
];

describe("readWorkbook", () => {
  it("reads every sheet, in the workbook's order, each on its own", async () => {
    const sheets = await readWorkbook(await workbook(MIXED));

    expect(sheets.map((sheet) => sheet.name)).toEqual([
      "Payments",
      "People",
      "Notes",
      "Lookup",
    ]);
    expect(sheets[0].headers).toEqual(["Date", "Paid to", "Amount"]);
    // The blank row is skipped, as the first sheet's always was.
    expect(sheets[0].rows).toEqual([
      { Date: "03/09/2026", "Paid to": "Hostinger", Amount: "4500" },
      { Date: "09/09/2026", "Paid to": "Courier", Amount: "640" },
    ]);
    expect(sheets[1].headers).toEqual(["Name", "Salary"]);
    expect(sheets[1].rows).toEqual([{ Name: "Rahim", Salary: "45000" }]);
  });

  it("keeps an empty sheet, with no rows, and says which are hidden", async () => {
    const sheets = await readWorkbook(await workbook(MIXED));

    expect(sheets[2]).toEqual({
      name: "Notes",
      hidden: true,
      headers: [],
      rows: [],
    });
    // A sheet Excel's own menus cannot show is hidden too.
    expect(sheets.map((sheet) => sheet.hidden)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it("reads a CSV as one sheet with no name", async () => {
    const sheets = await readWorkbook(
      Buffer.from("Date,Narration,Debit\n01/07/2026,rent,25000\n"),
    );
    expect(sheets).toEqual([
      {
        name: "",
        hidden: false,
        headers: ["Date", "Narration", "Debit"],
        rows: [{ Date: "01/07/2026", Narration: "rent", Debit: "25000" }],
      },
    ]);
  });
});

describe("readSpreadsheet, the Import screen's reader", () => {
  it("still reads the first sheet alone", async () => {
    const read = await readSpreadsheet(await workbook(MIXED));
    expect(read.headers).toEqual(["Date", "Paid to", "Amount"]);
    expect(read.rows).toHaveLength(2);
  });
});

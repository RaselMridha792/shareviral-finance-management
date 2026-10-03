/**
 * The file tools as the model is offered them (A3b): one file's are exactly
 * as they were; several files (a Sheet's tabs) make each tool say which.
 *
 * And an Excel workbook attached (A3c): every sheet, each kept on its own;
 * one sheet of data among empty ones, that sheet alone (A3d).
 */
import type { AiAttachment } from "@finance/shared";
import ExcelJS from "exceljs";

import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import type { DbService } from "../../db/db.service";
import {
  AI_ATTACHMENT_TOOLS,
  AiAttachmentsService,
  attachmentToolsFor,
  emptyPartsOf,
  sheetOrTab,
} from "./ai-attachments.service";

const file = (kind: AiAttachment["kind"]): AiAttachment => ({
  id: "00000000-0000-4000-8000-000000000000",
  name: "Expenses 2026 — Jan (tab 1 of 2)",
  kind,
  rowCount: 1,
  storedRows: 1,
  columns: [],
  sample: [],
  importBatchId: null,
});

describe("the file tools", () => {
  it("are as they were for one file, and a Doc reads alone", () => {
    expect(attachmentToolsFor([file("table")])).toBe(AI_ATTACHMENT_TOOLS);
    expect(attachmentToolsFor([file("text")]).map((t) => t.name)).toEqual([
      "read_attachment",
    ]);
  });

  it("ask which file when there are several, by its number", () => {
    const tools = attachmentToolsFor([file("table"), file("table")]);
    expect(tools.map((t) => t.name)).toEqual([
      "read_attachment",
      "group_attachment",
    ]);
    for (const tool of tools) {
      expect(tool.input_schema.properties).toHaveProperty("file", {
        type: "number",
        description: "Which file, by its number: FILE 1 to FILE 2",
      });
    }
    expect(tools[0].input_schema.required).toEqual(["file"]);
    expect(tools[1].input_schema.required).toEqual(["file", "by"]);
    // The shared list itself is left alone.
    expect(AI_ATTACHMENT_TOOLS[0].input_schema.properties).not.toHaveProperty(
      "file",
    );
  });
});

/* --- an Excel workbook attached (A3c) ------------------------------------ */

const actor = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "owner@example.com",
  fullName: "Owner",
  role: "super_admin",
  tokenVersion: 0,
} as AuthenticatedUser;

/**
 * A database that keeps what it is given and hands it back with an id, as
 * `insert … returning` does. Each insert is one statement, recorded whole.
 */
function fakeDb() {
  const statements: Record<string, unknown>[][] = [];
  const insert = jest.fn(() => ({
    values: (given: Record<string, unknown> | Record<string, unknown>[]) => {
      const rows = Array.isArray(given) ? given : [given];
      statements.push(rows);
      return {
        returning: () =>
          Promise.resolve(
            // Not in the order given, as Postgres need not be either.
            [...rows].reverse().map((row) => ({
              id: `id-${String(row.filename)}`,
              importBatchId: null,
              ...row,
            })),
          ),
      };
    },
  }));
  const db = { client: { insert } } as unknown as DbService;
  return { service: new AiAttachmentsService(db), statements };
}

async function xlsx(
  sheets: { name: string; rows: unknown[][]; hidden?: boolean }[],
): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const added = book.addWorksheet(sheet.name, {
      state: sheet.hidden ? "hidden" : "visible",
    });
    for (const row of sheet.rows) added.addRow(row);
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

const PAYMENTS = {
  name: "Payments",
  rows: [
    ["Date", "Paid to", "Amount"],
    ["03/09/2026", "Hostinger", 4500],
    ["09/09/2026", "Courier", 640],
  ],
};
const PEOPLE = {
  name: "People",
  rows: [
    ["Name", "Salary"],
    ["Rahim", 45000],
  ],
};

describe("an Excel workbook attached", () => {
  it("of one sheet is one file, named by the file alone, as before", async () => {
    const { service, statements } = fakeDb();
    const got = await service.upload(
      { originalname: "Bank July.xlsx", buffer: await xlsx([PAYMENTS]) },
      actor,
    );
    expect(got.map((file) => file.name)).toEqual(["Bank July.xlsx"]);
    expect(got[0].rowCount).toBe(2);
    expect(statements).toHaveLength(1);
  });

  it("of several sheets is every sheet, in order, each counted on its own, in one statement", async () => {
    const { service, statements } = fakeDb();
    const got = await service.upload(
      {
        originalname: "Book 2026.xlsx",
        buffer: await xlsx([
          PAYMENTS,
          PEOPLE,
          { name: "Notes", rows: [], hidden: true },
        ]),
      },
      actor,
    );

    expect(got.map((file) => file.name)).toEqual([
      "Book 2026.xlsx — Payments (sheet 1 of 3)",
      "Book 2026.xlsx — People (sheet 2 of 3)",
      "Book 2026.xlsx — Notes (sheet 3 of 3, hidden)",
    ]);
    expect(got.map((file) => file.rowCount)).toEqual([2, 1, 0]);
    expect(
      got[0].columns.find((column) => column.name === "Amount")?.total,
    ).toBe("5140.00");
    expect(
      got[1].columns.find((column) => column.name === "Salary")?.total,
    ).toBe("45000.00");
    // One statement, so one moment: how a reopened chat knows them for one.
    expect(statements).toHaveLength(1);
    expect(statements[0]).toHaveLength(3);
    expect(statements[0].every((row) => row.userId === actor.id)).toBe(true);
  });

  it("tells the model an empty sheet is empty, in the word for it", async () => {
    const { service } = fakeDb();
    const got = await service.upload(
      {
        originalname: "Book.xlsx",
        buffer: await xlsx([PAYMENTS, { name: "Blank", rows: [] }, PEOPLE]),
      },
      actor,
    );
    expect(service.describe(got[1], 2)).toBe(
      "FILE 2 ATTACHED: Book.xlsx — Blank (sheet 2 of 3)\nThis sheet is empty: no rows under a heading row. Nothing in it was read, and it has nothing to total.",
    );
    expect(sheetOrTab(got[0].name)).toBe("sheet");
    expect(sheetOrTab("Expenses 2026 — Jan (tab 1 of 2)")).toBe("tab");
  });

  it("is refused in words, and nothing kept: too many sheets, no rows, too many rows", async () => {
    const { service, statements } = fakeDb();
    const many = Array.from({ length: 21 }, (_, at) => ({
      name: `S${at + 1}`,
      rows: [["Amount"], [1]],
    }));
    await expect(
      service.upload(
        { originalname: "Many.xlsx", buffer: await xlsx(many) },
        actor,
      ),
    ).rejects.toThrow(
      '"Many.xlsx" has 21 sheets. The Assistant reads up to 20 at once',
    );

    await expect(
      service.upload(
        {
          originalname: "Blank.xlsx",
          buffer: await xlsx([
            { name: "A", rows: [["Amount"]] },
            { name: "B", rows: [] },
          ]),
        },
        actor,
      ),
    ).rejects.toThrow(
      '"Blank.xlsx" has no rows under a heading row on any of its 2 sheets.',
    );

    const big = Array.from({ length: 6_000 }, (_, at) => [at + 1]);
    await expect(
      service.upload(
        {
          originalname: "Big.xlsx",
          buffer: await xlsx([
            { name: "A", rows: [["Amount"], ...big] },
            { name: "B", rows: [["Amount"], ...big] },
          ]),
        },
        actor,
      ),
    ).rejects.toThrow('"Big.xlsx" has 12,000 rows across its 2 sheets.');

    expect(statements).toHaveLength(0);
  });
});

/* --- one sheet of data among empty ones (A3d) ---------------------------- */

describe("a workbook whose rows are all on one sheet", () => {
  it("is that sheet alone, one file, its empty sheets named on its second line", async () => {
    const { service, statements } = fakeDb();
    const got = await service.upload(
      {
        originalname: "Old book.xlsx",
        buffer: await xlsx([
          { ...PAYMENTS, name: "Sheet1" },
          { name: "Sheet2", rows: [] },
          // A heading with nothing under it holds no data either.
          { name: "Sheet3", rows: [["Amount"]], hidden: true },
        ]),
      },
      actor,
    );

    expect(got).toHaveLength(1);
    expect(got[0].name).toBe("Old book.xlsx — Sheet1\nSheet2, Sheet3: empty");
    expect(emptyPartsOf(got[0].name)).toEqual({
      name: "Old book.xlsx — Sheet1",
      empty: "Sheet2, Sheet3",
    });
    expect(got[0].rowCount).toBe(2);
    expect(
      got[0].columns.find((column) => column.name === "Amount")?.total,
    ).toBe("5140.00");
    expect(statements).toHaveLength(1);
    expect(statements[0]).toHaveLength(1);

    // One file: its tools ask for no file number, as a workbook of one
    // sheet's never did.
    expect(attachmentToolsFor(got)).toBe(AI_ATTACHMENT_TOOLS);

    // Told as one file, the rest said to be empty.
    const told = service.describe(got[0]);
    expect(told.split("\n").slice(0, 3)).toEqual([
      "FILE ATTACHED: Old book.xlsx — Sheet1",
      "The rest of the file is empty: Sheet2, Sheet3 — no rows under a heading row, so nothing there was read. This is the only part of the file that holds data, so it is the whole file.",
      "2 rows",
    ]);
    expect(told).toContain("- Amount (number, 2 filled) — total 5140.00");
    expect(told).toContain(
      "The totals above were computed from the file, not by you.",
    );
  });

  it("says when the one sheet of data is hidden, and reads it whatever the count of empty ones", async () => {
    const { service } = fakeDb();
    const empties = Array.from({ length: 24 }, (_, at) => ({
      name: `E${at + 1}`,
      rows: [],
    }));
    const got = await service.upload(
      {
        originalname: "Wide.xlsx",
        buffer: await xlsx([
          ...empties,
          { ...PEOPLE, name: "Data", hidden: true },
        ]),
      },
      actor,
    );
    expect(got).toHaveLength(1);
    expect(emptyPartsOf(got[0].name)).toEqual({
      name: "Wide.xlsx — Data (hidden)",
      empty: empties.map((sheet) => sheet.name).join(", "),
    });
  });

  it("leaves every other name alone", () => {
    for (const name of [
      "Bank July.xlsx",
      "Book 2026.xlsx — Notes (sheet 3 of 3, hidden)",
      "Expenses 2026 — Jan (tab 1 of 2)",
    ]) {
      expect(emptyPartsOf(name)).toEqual({ name, empty: null });
    }
  });
});

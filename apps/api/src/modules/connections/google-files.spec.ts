/**
 * A Google Sheet, Doc or Drive file read by its link (A3).
 *
 * No network: `fetch` is handed in, and answers as Google's three APIs
 * answer. What is pinned is this app's own part: which URL is asked, which
 * tab is read, how a Doc becomes lines, and the words each refusal becomes.
 */
import { findGoogleLinks, type GoogleLink } from "@finance/shared";

import {
  GoogleFileProblem,
  readGoogleFile,
  whyNotRead,
  type GoogleRead,
} from "./google-files";

const SHEET = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd";
const FILE = "1ZyXwVuTsRqPoNmLkJiHgFeDcBa98765";
const SHARE_WITH = "sfm-assistant@sfm-assistant.iam.gserviceaccount.com";
const LIMITS = { maxBytes: 5 * 1024 * 1024, maxRows: 10_000 };

type Route = { status?: number; json?: unknown; bytes?: Buffer } | "offline";

/** A stand-in for Google: each request answered by the first route it matches. */
function google(routes: Array<[RegExp, Route]>) {
  const asked: { url: string; auth: string | null }[] = [];
  const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    asked.push({
      url,
      auth: new Headers(init?.headers).get("authorization"),
    });
    const route = routes.find(([pattern]) => pattern.test(url))?.[1] ?? {
      status: 404,
      json: {
        error: { code: 404, message: "Requested entity was not found." },
      },
    };
    if (route === "offline") {
      return Promise.reject(new TypeError("fetch failed"));
    }
    if (route.bytes) {
      return Promise.resolve(
        new Response(new Uint8Array(route.bytes), {
          status: route.status ?? 200,
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(route.json ?? {}), {
        status: route.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return { fetcher, asked };
}

const link = (url: string): GoogleLink => findGoogleLinks(url)[0];
const read = (url: string, fetcher: typeof fetch) =>
  readGoogleFile(
    link(url),
    { token: "ya29.stand-in", shareWith: SHARE_WITH },
    LIMITS,
    fetcher,
  );
const refusal = async (promise: Promise<GoogleRead>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GoogleFileProblem) {
      return { message: error.message, unavailable: error.unavailable };
    }
    throw error;
  }
  throw new Error("expected a refusal");
};

const SHEET_META = {
  properties: { title: "Expenses 2026" },
  sheets: [
    { properties: { sheetId: 0, title: "Jan", index: 0, sheetType: "GRID" } },
    {
      properties: {
        sheetId: 77,
        title: "Chart",
        index: 1,
        sheetType: "OBJECT",
      },
    },
    {
      properties: {
        sheetId: 1834620192,
        title: "Feb's",
        index: 2,
        sheetType: "GRID",
      },
    },
  ],
};

describe("a Google Sheet", () => {
  it("reads the tab its link names, as headings and rows of text", async () => {
    const { fetcher, asked } = google([
      [
        /\/values\//,
        {
          json: {
            values: [
              ["Date", "Details", "Amount", ""],
              ["17/02/2026", "Netflix", 1200.5, "x"],
              [],
              ["", "", ""],
              ["18/02/2026", "ChatGPT Plus", 2400],
            ],
          },
        },
      ],
      [/spreadsheets\/[^/]+\?fields=/, { json: SHEET_META }],
    ]);

    const got = await read(
      `https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=1834620192`,
      fetcher,
    );

    expect(got).toEqual({
      kind: "table",
      name: "Expenses 2026 — Feb's (tab 2 of 2)",
      headers: ["Date", "Details", "Amount"],
      rows: [
        { Date: "17/02/2026", Details: "Netflix", Amount: "1200.5" },
        { Date: "18/02/2026", Details: "ChatGPT Plus", Amount: "2400" },
      ],
    });
    // The tab by its own name, quoted, the apostrophe doubled; figures as
    // numbers, dates as the sheet shows them.
    const values = decodeURIComponent(asked[1].url);
    expect(values).toContain("/values/'Feb''s'?");
    expect(values).toContain("valueRenderOption=UNFORMATTED_VALUE");
    expect(values).toContain("dateTimeRenderOption=FORMATTED_STRING");
    expect(asked.every((a) => a.auth === "Bearer ya29.stand-in")).toBe(true);
  });

  it("reads the first tab of cells when the link names none", async () => {
    const { fetcher } = google([
      [/\/values\//, { json: { values: [["Name"], ["Rahim"]] } }],
      [/spreadsheets\/[^/]+\?fields=/, { json: SHEET_META }],
    ]);
    const got = await read(
      `https://docs.google.com/spreadsheets/d/${SHEET}/edit`,
      fetcher,
    );
    expect(got.kind === "table" && got.name).toBe(
      "Expenses 2026 — Jan (tab 1 of 2)",
    );
  });

  it("names a one-tab sheet by its title alone", async () => {
    const { fetcher } = google([
      [/\/values\//, { json: { values: [["Name"], ["Rahim"]] } }],
      [
        /spreadsheets\/[^/]+\?fields=/,
        {
          json: {
            properties: { title: "Team" },
            sheets: [{ properties: { sheetId: 0, title: "Sheet1", index: 0 } }],
          },
        },
      ],
    ]);
    const got = await read(
      `https://docs.google.com/spreadsheets/d/${SHEET}/edit`,
      fetcher,
    );
    expect(got.kind === "table" && got.name).toBe("Team");
  });

  it("refuses a tab the sheet no longer has, rather than reading another", async () => {
    const { fetcher } = google([
      [/spreadsheets\/[^/]+\?fields=/, { json: SHEET_META }],
    ]);
    const got = await refusal(
      read(
        `https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=5`,
        fetcher,
      ),
    );
    expect(got.message).toMatch(/no tab with that link any more/);
  });

  it("reads an .xlsx opened in Sheets through Drive, as the upload would", async () => {
    const { fetcher } = google([
      [
        /sheets\.googleapis\.com/,
        {
          status: 400,
          json: {
            error: {
              code: 400,
              message: "This operation is not supported for this document",
              status: "FAILED_PRECONDITION",
            },
          },
        },
      ],
      [/alt=media/, { bytes: Buffer.from("PK-xlsx-bytes") }],
      [
        /drive\/v3\/files\//,
        {
          json: {
            id: SHEET,
            name: "Bank July.xlsx",
            mimeType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            size: "13",
          },
        },
      ],
    ]);
    const got = await read(
      `https://docs.google.com/spreadsheets/d/${SHEET}/edit`,
      fetcher,
    );
    expect(got.kind).toBe("file");
    expect(got.kind === "file" && got.name).toBe("Bank July.xlsx");
    expect(got.kind === "file" && got.buffer.toString()).toBe("PK-xlsx-bytes");

    // The upload's reader takes a workbook's first sheet: a link to another
    // tab says so rather than pass that sheet off as the tab.
    const tab = await read(
      `https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=99`,
      fetcher,
    );
    expect(tab.kind === "file" && tab.name).toBe(
      "Bank July (first sheet).xlsx",
    );
  });
});

describe("a Google Doc", () => {
  const paragraph = (text: string, bullet = false) => ({
    paragraph: {
      elements: [{ textRun: { content: text } }],
      ...(bullet ? { bullet: { listId: "a" } } : {}),
    },
  });
  const cell = (text: string) => ({ content: [paragraph(`${text}\n`)] });

  it("becomes its lines: paragraphs, bullets, and a table a row to a line", async () => {
    const { fetcher, asked } = google([
      [
        /documents\//,
        {
          json: {
            title: "Board notes",
            tabs: [
              {
                tabProperties: { title: "September" },
                documentTab: {
                  body: {
                    content: [
                      { sectionBreak: {} },
                      paragraph("Payments this month\n"),
                      paragraph("Claude Max renewed\u000bon the 2nd\n", true),
                      paragraph("\n"),
                      {
                        table: {
                          tableRows: [
                            { tableCells: [cell("Vendor"), cell("Amount")] },
                            {
                              tableCells: [cell("Hostinger"), cell("৳ 4,500")],
                            },
                            { tableCells: [cell(""), cell("")] },
                          ],
                        },
                      },
                    ],
                  },
                },
                childTabs: [
                  {
                    tabProperties: { title: "Notes" },
                    documentTab: {
                      body: { content: [paragraph("Ask Rahim\n")] },
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    ]);

    const got = await read(
      `https://docs.google.com/document/d/${SHEET}/edit?tab=t.0`,
      fetcher,
    );

    expect(got).toEqual({
      kind: "text",
      name: "Board notes",
      paragraphs: [
        "[Tab: September]",
        "Payments this month",
        "• Claude Max renewed on the 2nd",
        "Vendor | Amount",
        "Hostinger | ৳ 4,500",
        "[Tab: Notes]",
        "Ask Rahim",
      ],
    });
    expect(asked[0].url).toContain("includeTabsContent=true");
  });

  it("reads an older Doc that has a body and no tabs", async () => {
    const { fetcher } = google([
      [
        /documents\//,
        {
          json: { title: "Old", body: { content: [paragraph("One line\n")] } },
        },
      ],
    ]);
    const got = await read(
      `https://docs.google.com/document/d/${SHEET}/edit`,
      fetcher,
    );
    expect(got.kind === "text" && got.paragraphs).toEqual(["One line"]);
  });

  it("refuses an empty Doc in words", async () => {
    const { fetcher } = google([
      [/documents\//, { json: { title: "Blank", tabs: [] } }],
    ]);
    const got = await refusal(
      read(`https://docs.google.com/document/d/${SHEET}/edit`, fetcher),
    );
    expect(got.message).toBe('"Blank" has no text in it.');
  });
});

describe("a file kept in Drive", () => {
  it("downloads a PDF for the upload's own reader", async () => {
    const { fetcher, asked } = google([
      [/alt=media/, { bytes: Buffer.from("%PDF-1.7") }],
      [
        /drive\/v3\/files\//,
        {
          json: {
            name: "City Bank Sept",
            mimeType: "application/pdf",
            size: "8",
          },
        },
      ],
    ]);
    const got = await read(
      `https://drive.google.com/file/d/${FILE}/view?usp=sharing`,
      fetcher,
    );
    // A name with no extension gets the one its type says, so the upload
    // knows how to read it.
    expect(got.kind === "file" && got.name).toBe("City Bank Sept.pdf");
    expect(asked[1].url).toContain("supportsAllDrives=true");
  });

  it("sends a Sheet linked through Drive to the Sheet reader", async () => {
    const { fetcher } = google([
      [/\/values\//, { json: { values: [["Name"], ["Rahim"]] } }],
      [
        /spreadsheets\/[^/]+\?fields=/,
        {
          json: {
            properties: { title: "Team" },
            sheets: [{ properties: { sheetId: 0, title: "Sheet1", index: 0 } }],
          },
        },
      ],
      [
        /drive\/v3\/files\//,
        {
          json: {
            name: "Team",
            mimeType: "application/vnd.google-apps.spreadsheet",
          },
        },
      ],
    ]);
    const got = await read(`https://drive.google.com/open?id=${FILE}`, fetcher);
    expect(got.kind === "table" && got.rows).toEqual([{ Name: "Rahim" }]);
  });

  it("follows a shortcut to the file it points at", async () => {
    const target = "1TargetTargetTargetTargetTarget00";
    const { fetcher } = google([
      [new RegExp(`${target}\\?alt=media`), { bytes: Buffer.from("a,b\n1,2") }],
      [
        new RegExp(`files/${target}\\?`),
        {
          json: { name: "rows.csv", mimeType: "text/csv", size: "7" },
        },
      ],
      [
        /drive\/v3\/files\//,
        {
          json: {
            name: "rows.csv",
            mimeType: "application/vnd.google-apps.shortcut",
            shortcutDetails: { targetId: target },
          },
        },
      ],
    ]);
    const got = await read(
      `https://drive.google.com/file/d/${FILE}/view`,
      fetcher,
    );
    expect(got.kind === "file" && got.buffer.toString()).toBe("a,b\n1,2");
  });

  it("refuses a picture, a folder, a Word file and a file over the limit, each in words", async () => {
    const meta = (json: unknown) =>
      google([[/drive\/v3\/files\//, { json }]]).fetcher;
    const url = `https://drive.google.com/file/d/${FILE}/view`;

    expect(
      (
        await refusal(
          read(url, meta({ name: "slip.jpg", mimeType: "image/jpeg" })),
        )
      ).message,
    ).toMatch(
      /"slip\.jpg" is a picture\. Reading a receipt or a slip from a picture is not built yet/,
    );
    expect(
      (
        await refusal(
          read(
            url,
            meta({
              name: "Q3",
              mimeType: "application/vnd.google-apps.folder",
            }),
          ),
        )
      ).message,
    ).toMatch(/That is a Drive folder/);
    expect(
      (
        await refusal(
          read(
            url,
            meta({
              name: "letter.docx",
              mimeType:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            }),
          ),
        )
      ).message,
    ).toMatch(/"letter\.docx" is not a kind of file the Assistant can read/);
    expect(
      (
        await refusal(
          read(
            url,
            meta({
              name: "huge.csv",
              mimeType: "text/csv",
              size: String(6 * 1024 * 1024),
            }),
          ),
        )
      ).message,
    ).toMatch(/"huge\.csv" is larger than the 5 MB the Assistant reads/);
  });
});

describe("Google's refusals, in words", () => {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET}/edit`;
  const answering = (route: Route) => google([[/./, route]]).fetcher;

  it("a file never shared with the account: share it with this address", async () => {
    for (const route of [
      {
        status: 403,
        json: {
          error: {
            code: 403,
            message: "The caller does not have permission",
            status: "PERMISSION_DENIED",
          },
        },
      },
      {
        status: 404,
        json: {
          error: { code: 404, message: "Requested entity was not found." },
        },
      },
    ]) {
      const got = await refusal(read(url, answering(route)));
      expect(got.message).toBe(
        `Share this file with ${SHARE_WITH} first (Viewer is enough), then send the link again. If it is shared already, check that the link was copied whole.`,
      );
      expect(got.unavailable).toBe(false);
    }
  });

  it("an API not switched on: names which, and where", async () => {
    const got = await refusal(
      read(
        url,
        answering({
          status: 403,
          json: {
            error: {
              code: 403,
              message:
                "Google Sheets API has not been used in project 1 before or it is disabled.",
              status: "PERMISSION_DENIED",
              details: [{ reason: "SERVICE_DISABLED" }],
            },
          },
        }),
      ),
    );
    expect(got.message).toMatch(
      /^The Google Sheets API is not switched on in the Google Cloud project/,
    );
  });

  it("Google not answering, or limiting: worth trying again", async () => {
    for (const route of [
      "offline",
      { status: 503, json: {} },
      { status: 429, json: {} },
    ] as Route[]) {
      const got = await refusal(read(url, answering(route)));
      expect(got.unavailable).toBe(true);
    }
  });

  it("a key Google no longer takes", async () => {
    const got = await refusal(read(url, answering({ status: 401, json: {} })));
    expect(got.message).toMatch(/Google refused the service-account key/);
  });
});

describe("whyNotRead", () => {
  it("refuses a folder, a kind nothing reads, and a link with no file, before asking Google", () => {
    expect(
      whyNotRead(link(`https://drive.google.com/drive/folders/${FILE}`)),
    ).toMatch(/Drive folder/);
    expect(
      whyNotRead(link(`https://docs.google.com/presentation/d/${SHEET}/edit`)),
    ).toMatch(/not to a file the Assistant can read/);
    expect(
      whyNotRead(link("https://drive.google.com/file/d/short/view")),
    ).toMatch(/has no file in it/);
    expect(
      whyNotRead(link(`https://drive.google.com/file/d/${FILE}/view`)),
    ).toBeNull();
  });
});

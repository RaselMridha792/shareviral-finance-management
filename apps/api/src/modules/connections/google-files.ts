import { AI_ATTACHMENT_EXTENSIONS, type GoogleLink } from "@finance/shared";

import type { RawRow } from "../imports/row-parser";
import { readGrid } from "../imports/spreadsheet";
import { GOOGLE_READ_SCOPES, googleAuth, type ServiceAccount } from "./google";

/**
 * A Google Sheet, Doc or Drive file, read by its link (A3, 2 Oct 2026).
 *
 * Step 3 of docs/briefs/2026-10-01-google-connections.md. The service account
 * reads what the owner shared with it, with the three read-only scopes, so
 * nothing here could change a file even if it tried. What comes back is one
 * of the three things an attachment already is:
 *
 * - a Sheet's tab: headings and rows, as an uploaded .xlsx gives;
 * - a Doc: its paragraphs, in order;
 * - a file kept in Drive (.xlsx, .csv, .pdf): its bytes, which then go through
 *   the upload's own reader, the PDF transcription included.
 *
 * Every refusal is a sentence the person can act on: most often, sharing the
 * file with the account's address.
 */
export type GoogleRead =
  | { kind: "table"; name: string; headers: string[]; rows: RawRow[] }
  | { kind: "text"; name: string; paragraphs: string[] }
  | { kind: "file"; name: string; buffer: Buffer };

/**
 * Why a link was not read. `unavailable` is Google not answering, worth
 * trying again; anything else needs somebody to change something first.
 */
export class GoogleFileProblem extends Error {
  constructor(
    message: string,
    readonly unavailable = false,
  ) {
    super(message);
  }
}

const DRIVE = "https://www.googleapis.com/drive/v3/files";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const DOCS = "https://docs.googleapis.com/v1/documents";

const SHEET_TYPE = "application/vnd.google-apps.spreadsheet";
const DOC_TYPE = "application/vnd.google-apps.document";
const FOLDER_TYPE = "application/vnd.google-apps.folder";
const SHORTCUT_TYPE = "application/vnd.google-apps.shortcut";

/** What Drive calls the kinds of file an upload takes, and their extension. */
const DOWNLOADABLE: Record<string, string> = {
  "text/csv": ".csv",
  "text/tab-separated-values": ".tsv",
  "text/plain": ".txt",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-excel": ".xls",
  "application/pdf": ".pdf",
};

/**
 * A Doc longer than this is refused rather than cut. Two hundred thousand
 * characters is a hundred pages; the model reads it a window at a time.
 */
const MAX_DOC_CHARACTERS = 200_000;

const READS =
  "The Assistant reads Google Sheets and Docs, and Excel, CSV and PDF files kept in Drive.";

/** What a link is, when it is something no Google call could read. */
export function whyNotRead(link: GoogleLink): string | null {
  if (link.kind === "folder") {
    return "That is a Drive folder. Reading a whole folder is not built yet: open the folder and paste the link of one file in it.";
  }
  if (link.kind === "other") {
    return `That Google link is not to a file the Assistant can read. ${READS} Copy the link from the file's Share button.`;
  }
  if (!link.id) {
    return "That link has no file in it. Copy it again from the file's Share button.";
  }
  return null;
}

/** A read-only token for the stored key, or why Google would not give one. */
export async function googleReadToken(
  account: ServiceAccount,
): Promise<string> {
  try {
    const token = await googleAuth(
      account,
      GOOGLE_READ_SCOPES,
    ).getAccessToken();
    if (token) return token;
  } catch (error) {
    if (!(error as { response?: unknown }).response) {
      throw new GoogleFileProblem(
        "Could not reach Google. Try again in a moment.",
        true,
      );
    }
  }
  throw new GoogleFileProblem(
    "Google refused the service-account key. A Super Admin can check it under Settings → Connections.",
  );
}

type Reply = {
  status: number;
  body: Record<string, unknown> | null;
  bytes?: Buffer;
};

/**
 * Reads the file a link points to.
 *
 * `fetcher` is the global `fetch`; a test hands in its own. Nothing else here
 * reaches outside the process.
 */
export async function readGoogleFile(
  link: GoogleLink,
  access: { token: string; shareWith: string },
  limits: { maxBytes: number; maxRows: number },
  fetcher: typeof fetch = fetch,
): Promise<GoogleRead> {
  const why = whyNotRead(link);
  if (why) throw new GoogleFileProblem(why);
  const reader = new Reader(access, limits, fetcher);
  const id = link.id!;
  if (link.kind === "sheet") return reader.sheet(id, link.gid);
  if (link.kind === "doc") return reader.doc(id);
  return reader.drive(id);
}

class Reader {
  constructor(
    private readonly access: { token: string; shareWith: string },
    private readonly limits: { maxBytes: number; maxRows: number },
    private readonly fetcher: typeof fetch,
  ) {}

  /* --- a Sheet -------------------------------------------------------- */

  /**
   * One tab: the one the link names, or else the first.
   *
   * Only one, because an attachment is one table. The name says which tab
   * and how many there are, so nobody takes the first tab for the whole
   * book; another tab is read by pasting its own link.
   */
  async sheet(
    id: string,
    gid?: string,
    fromDrive = false,
  ): Promise<GoogleRead> {
    const meta = await this.get(
      `${SHEETS}/${encodeURIComponent(id)}?fields=${encodeURIComponent(
        "properties.title,sheets.properties(sheetId,title,index,sheetType)",
      )}`,
    );
    // An .xlsx opened in Sheets without being converted is still a Drive
    // file, and the Sheets API will not read it. Drive will, through the
    // upload's reader, which takes a workbook's first sheet. A link to
    // another tab of it says so in the name rather than pass that sheet off
    // as the tab.
    if (!fromDrive && notNative(meta)) {
      const read = await this.drive(id, 1);
      if (gid !== undefined && read.kind === "file") {
        return {
          ...read,
          name: read.name.replace(/(\.[^.]+)$/, " (first sheet)$1"),
        };
      }
      return read;
    }
    if (meta.status !== 200) throw this.refused("Google Sheets API", meta);

    const title = text(record(meta.body?.properties).title) || "Google Sheet";
    const tabs = list(meta.body?.sheets)
      .map((sheet) => record(record(sheet).properties))
      // A chart on a tab of its own has no cells.
      .filter((tab) => (text(tab.sheetType) || "GRID") === "GRID")
      .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));

    const at =
      gid === undefined
        ? 0
        : tabs.findIndex((tab) => String(tab.sheetId) === gid);
    const tab = tabs[at];
    if (!tab) {
      throw new GoogleFileProblem(
        gid === undefined
          ? `"${title}" has no tab of cells to read.`
          : `"${title}" has no tab with that link any more. Open the tab you mean and copy its link again.`,
      );
    }

    const tabTitle = text(tab.title);
    const values = await this.get(
      `${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(
        `'${tabTitle.replace(/'/g, "''")}'`,
      )}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING&majorDimension=ROWS`,
    );
    if (values.status !== 200) throw this.refused("Google Sheets API", values);

    const { headers, rows } = readGrid(
      list(values.body?.values).map((row) => list(row)),
    );
    return {
      kind: "table",
      name:
        tabs.length > 1
          ? `${title} — ${tabTitle} (tab ${at + 1} of ${tabs.length})`
          : title,
      headers,
      rows,
    };
  }

  /* --- a Doc ---------------------------------------------------------- */

  /**
   * Its text, a paragraph to a line. A table becomes one line a row, its
   * cells parted by " | ", so a figure stays beside what it was for. Every
   * tab of the Doc is read, each headed by its name.
   */
  async doc(id: string, fromDrive = false): Promise<GoogleRead> {
    const reply = await this.get(
      `${DOCS}/${encodeURIComponent(id)}?includeTabsContent=true`,
    );
    if (!fromDrive && notNative(reply)) return this.drive(id, 1);
    if (reply.status !== 200) throw this.refused("Google Docs API", reply);

    const title = text(reply.body?.title) || "Google Doc";
    const tabs = flattenTabs(list(reply.body?.tabs));
    const paragraphs: string[] = [];

    if (tabs.length) {
      for (const tab of tabs) {
        const lines = linesOf(
          list(record(record(tab.documentTab).body).content),
        );
        if (tabs.length > 1 && lines.length) {
          paragraphs.push(`[Tab: ${text(record(tab.tabProperties).title)}]`);
        }
        paragraphs.push(...lines);
      }
    } else {
      paragraphs.push(...linesOf(list(record(reply.body?.body).content)));
    }

    if (!paragraphs.length) {
      throw new GoogleFileProblem(`"${title}" has no text in it.`);
    }
    const characters = paragraphs.reduce((sum, line) => sum + line.length, 0);
    if (
      characters > MAX_DOC_CHARACTERS ||
      paragraphs.length > this.limits.maxRows
    ) {
      throw new GoogleFileProblem(
        `"${title}" is longer than the Assistant reads at once (${MAX_DOC_CHARACTERS.toLocaleString("en-US")} characters, ${this.limits.maxRows.toLocaleString("en-US")} paragraphs). Split it into smaller Docs.`,
      );
    }
    return { kind: "text", name: title, paragraphs };
  }

  /* --- a file in Drive ------------------------------------------------ */

  /**
   * Whatever Drive holds under the id. A Sheet or Doc goes to its own reader;
   * a shortcut is followed once; a file the upload takes is downloaded.
   */
  async drive(id: string, depth = 0): Promise<GoogleRead> {
    const meta = await this.get(
      `${DRIVE}/${encodeURIComponent(id)}?fields=${encodeURIComponent(
        "id,name,mimeType,size,shortcutDetails(targetId)",
      )}&supportsAllDrives=true`,
    );
    if (meta.status !== 200) throw this.refused("Google Drive API", meta);

    const name = text(meta.body?.name) || "Drive file";
    const type = text(meta.body?.mimeType);

    if (type === SHORTCUT_TYPE) {
      const target = text(record(meta.body?.shortcutDetails).targetId);
      if (target && depth < 2) return this.drive(target, depth + 1);
    }
    if (type === SHEET_TYPE) return this.sheet(id, undefined, true);
    if (type === DOC_TYPE) return this.doc(id, true);
    if (type === FOLDER_TYPE) {
      throw new GoogleFileProblem(whyNotRead({ url: "", kind: "folder", id })!);
    }
    if (type.startsWith("image/")) {
      throw new GoogleFileProblem(
        `"${name}" is a picture. Reading a receipt or a slip from a picture is not built yet. ${READS}`,
      );
    }

    const dot = name.lastIndexOf(".");
    const own = dot > 0 ? name.slice(dot).toLowerCase() : "";
    const extension = (AI_ATTACHMENT_EXTENSIONS as readonly string[]).includes(
      own,
    )
      ? own
      : DOWNLOADABLE[type];
    if (!extension) {
      throw new GoogleFileProblem(
        `"${name}" is not a kind of file the Assistant can read. ${READS}`,
      );
    }

    const tooBig = () =>
      new GoogleFileProblem(
        `"${name}" is larger than the ${Math.round(this.limits.maxBytes / 1024 / 1024)} MB the Assistant reads. Split it, or take it straight to Import.`,
      );
    if (Number(meta.body?.size ?? 0) > this.limits.maxBytes) throw tooBig();

    const file = await this.get(
      `${DRIVE}/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`,
      true,
    );
    if (file.status !== 200 || !file.bytes) {
      throw this.refused("Google Drive API", file);
    }
    if (file.bytes.length > this.limits.maxBytes) throw tooBig();

    return {
      kind: "file",
      name: own === extension ? name : `${name}${extension}`,
      buffer: file.bytes,
    };
  }

  /* --- asking Google -------------------------------------------------- */

  /** A read-only GET. Status 0 means Google was not reached at all. */
  private async get(url: string, bytes = false): Promise<Reply> {
    try {
      const response = await this.fetcher(url, {
        headers: { Authorization: `Bearer ${this.access.token}` },
        signal: AbortSignal.timeout(bytes ? 60_000 : 30_000),
      });
      if (bytes && response.ok) {
        return {
          status: response.status,
          body: null,
          bytes: Buffer.from(await response.arrayBuffer()),
        };
      }
      const body = (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      return { status: response.status, body };
    } catch {
      return { status: 0, body: null };
    }
  }

  /**
   * Google's refusal, in words.
   *
   * Google answers 403 or 404 alike for a file that was never shared with
   * the account and for a link that was cut short, and cannot be asked which,
   * so the sentence names both, the usual one first.
   */
  private refused(api: string, reply: Reply): GoogleFileProblem {
    const error = record(reply.body?.error);
    const said = text(error.message);

    if (reply.status === 0) {
      return new GoogleFileProblem(
        "Could not reach Google. Try again in a moment.",
        true,
      );
    }
    if (reply.status === 401) {
      return new GoogleFileProblem(
        "Google refused the service-account key. A Super Admin can check it under Settings → Connections.",
      );
    }
    if (
      reply.status === 403 &&
      /SERVICE_DISABLED|accessNotConfigured|has not been used|is disabled/i.test(
        JSON.stringify(error),
      )
    ) {
      return new GoogleFileProblem(
        `The ${api} is not switched on in the Google Cloud project. A Super Admin enables it under APIs & Services, then presses Test under Settings → Connections.`,
      );
    }
    if (reply.status === 403 || reply.status === 404) {
      return new GoogleFileProblem(
        `Share this file with ${this.access.shareWith} first (Viewer is enough), then send the link again. If it is shared already, check that the link was copied whole.`,
      );
    }
    if (reply.status === 429) {
      return new GoogleFileProblem(
        "Google is limiting requests just now. Try again in a minute.",
        true,
      );
    }
    if (reply.status >= 500) {
      return new GoogleFileProblem(
        "Google is not answering at the moment. Try again in a moment.",
        true,
      );
    }
    return new GoogleFileProblem(
      `Google would not read that file: ${said || `status ${reply.status}`}.`,
    );
  }
}

/** Sheets and Docs say this of an Office file that was opened, not converted. */
function notNative(reply: Reply): boolean {
  return (
    reply.status === 400 &&
    /not supported for this document/i.test(
      text(record(reply.body?.error).message),
    )
  );
}

/** A Doc's tabs, each before the tabs nested under it. */
function flattenTabs(tabs: unknown[]): Record<string, unknown>[] {
  return tabs.flatMap((tab) => [
    record(tab),
    ...flattenTabs(list(record(tab).childTabs)),
  ]);
}

/** The lines of a Doc's body: paragraphs, and a table a row to a line. */
function linesOf(content: unknown[]): string[] {
  const lines: string[] = [];
  for (const item of content.map(record)) {
    if (item.paragraph) {
      const paragraph = record(item.paragraph);
      const line = list(paragraph.elements)
        .map((element) => text(record(record(element).textRun).content))
        .join("")
        // A line break inside a paragraph (Shift+Enter) is a vertical tab in
        // Docs, and every paragraph ends in a newline.
        .split(VERTICAL_TAB)
        .join(" ")
        .replace(/[\r\n]+/g, " ")
        .trim();
      if (line) lines.push(paragraph.bullet ? `• ${line}` : line);
    } else if (item.table) {
      for (const row of list(record(item.table).tableRows)) {
        const cells = list(record(row).tableCells).map((cell) =>
          linesOf(list(record(cell).content)).join(" "),
        );
        if (cells.some(Boolean)) lines.push(cells.join(" | "));
      }
    }
    // A table of contents repeats the headings, and a section break holds
    // nothing; neither is part of what was written.
  }
  return lines;
}

const VERTICAL_TAB = String.fromCharCode(11);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

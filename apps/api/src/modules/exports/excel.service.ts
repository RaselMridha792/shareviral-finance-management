import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";

import { SettingsService } from "../settings/settings.service";

export type ColumnKind = "text" | "money" | "date" | "number";

export type SheetColumn<T> = {
  header: string;
  key: string;
  kind: ColumnKind;
  width?: number;
  value: (row: T) => string | number | Date | null | undefined;
};

export type SheetSpec<T> = {
  title: string;
  /** Lines above the table: what was filtered, when, by whom. */
  subtitle?: string[];
  columns: SheetColumn<T>[];
  rows: T[];
  /** Sums the named money columns in a bold row at the bottom. */
  totalColumns?: string[];
};

/**
 * Builds .xlsx files.
 *
 * Amounts are written as **numbers with a number format**, never as
 * pre-formatted strings. A string that looks like "৳12,50,000.00" cannot be
 * summed, sorted, or charted in Excel — which is most of the reason to export
 * to Excel at all.
 */
@Injectable()
export class ExcelService {
  private static readonly MONEY_FORMAT = "#,##0.00";
  /**
   * Lakh–crore grouping, the way the rest of the app writes taka.
   *
   * Excel's repeat rule: the comma nearest the decimal point sets the last
   * group, and the one before it repeats leftwards — so `#,##,##0.00` gives
   * 12,50,000.00 rather than 1,250,000.00. Without this every sheet
   * contradicted its own subtitle, which is written by `formatMoney` and does
   * group in lakhs.
   */
  private static readonly MONEY_FORMAT_BD = "#,##,##0.00";
  /*
   * Day, month, year — the same reading as every screen, now that
   * `formatIsoDate` decides that for the whole app. A number format rather
   * than a string, so the cell stays a real date and Excel can still sort and
   * filter it chronologically; only what the reader sees changes.
   */
  private static readonly DATE_FORMAT = "dd/mm/yyyy";
  /**
   * Rates and percentages: still a real number, but one that keeps the digits
   * it was given. Under the general format Excel drops trailing zeros, so a
   * realised rate of 118.3000 displayed as `118.3` and 118.0000 as plain
   * `118` — the figure looked rounded when it was not.
   */
  private static readonly NUMBER_FORMAT = "#,##0.0000";
  /** Above this, the browser and Excel both start to struggle. */
  static readonly MAX_ROWS = 20_000;

  constructor(private readonly settings: SettingsService) {}

  /** The money format this company reads, from Settings. */
  private async moneyFormat(): Promise<string> {
    const settings = await this.settings.get();
    return settings.numberFormat === "bangladeshi"
      ? ExcelService.MONEY_FORMAT_BD
      : ExcelService.MONEY_FORMAT;
  }

  async build<T>(spec: SheetSpec<T>): Promise<Buffer> {
    const money = await this.moneyFormat();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "ShareViral Finance Management";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet(sanitiseSheetName(spec.title), {
      views: [{ state: "frozen", ySplit: headerRowCount(spec) }],
    });

    let cursor = 1;

    sheet.getCell(cursor, 1).value = spec.title;
    sheet.getCell(cursor, 1).font = { bold: true, size: 14 };
    cursor++;

    for (const line of spec.subtitle ?? []) {
      sheet.getCell(cursor, 1).value = line;
      sheet.getCell(cursor, 1).font = { size: 10, color: { argb: "FF6B7280" } };
      cursor++;
    }
    cursor++; // blank line before the table

    const headerRow = sheet.getRow(cursor);
    spec.columns.forEach((column, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = column.header;
      cell.font = { bold: true };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF1F3F6" },
      };
      cell.border = { bottom: { style: "thin", color: { argb: "FFC9D2E0" } } };
      cell.alignment = {
        horizontal:
          column.kind === "money" || column.kind === "number"
            ? "right"
            : "left",
      };
      sheet.getColumn(index + 1).width =
        column.width ?? defaultWidth(column.kind);
    });
    const headerAt = cursor;
    cursor++;

    for (const row of spec.rows) {
      const sheetRow = sheet.getRow(cursor);
      spec.columns.forEach((column, index) => {
        const cell = sheetRow.getCell(index + 1);
        const value = column.value(row);

        if (value === null || value === undefined || value === "") {
          cell.value = null;
          return;
        }

        switch (column.kind) {
          case "money":
            cell.value = Number(value);
            cell.numFmt = money;
            cell.alignment = { horizontal: "right" };
            break;
          case "number":
            cell.value = Number(value);
            // Keeps the digits it was given: a rate of 118.3000 must not
            // display as 118.3, which reads as a different, rounder figure.
            cell.numFmt = ExcelService.NUMBER_FORMAT;
            cell.alignment = { horizontal: "right" };
            break;
          case "date":
            // A real date so Excel can sort and filter chronologically.
            //
            // Parsed as UTC, not local. `new Date("2026-08-05T00:00:00")` is
            // local midnight, which in Dhaka is 2026-08-04 18:00 UTC — and
            // exceljs serialises in UTC, so every exported date would land a
            // day early.
            cell.value =
              value instanceof Date ? value : parseIsoAsUtc(String(value));
            cell.numFmt = ExcelService.DATE_FORMAT;
            break;
          default:
            cell.value = String(value);
        }
      });
      cursor++;
    }

    if (spec.totalColumns?.length && spec.rows.length > 0) {
      const totalRow = sheet.getRow(cursor);
      totalRow.getCell(1).value = "Total";
      totalRow.getCell(1).font = { bold: true };

      spec.columns.forEach((column, index) => {
        if (!spec.totalColumns?.includes(column.key)) return;
        const letter = sheet.getColumn(index + 1).letter;
        const cell = totalRow.getCell(index + 1);
        // A formula, not a computed constant — so the total stays right if
        // someone deletes a row in Excel.
        cell.value = {
          formula: `SUM(${letter}${headerAt + 1}:${letter}${cursor - 1})`,
        };
        cell.numFmt = money;
        cell.font = { bold: true };
        cell.border = { top: { style: "thin", color: { argb: "FFC9D2E0" } } };
      });
    }

    sheet.autoFilter = {
      from: { row: headerAt, column: 1 },
      to: { row: headerAt, column: spec.columns.length },
    };

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /** `sfm-transactions-2026-08-13.xlsx` */
  static filename(base: string, today: string): string {
    return `sfm-${base}-${today}.xlsx`;
  }
}

/** `2026-08-05` → midnight UTC on that calendar day. */
function parseIsoAsUtc(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return new Date(value);
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
}

function headerRowCount(spec: SheetSpec<unknown>): number {
  return 1 + (spec.subtitle?.length ?? 0) + 2;
}

function defaultWidth(kind: ColumnKind): number {
  return kind === "money" ? 16 : kind === "date" ? 14 : 22;
}

/** Excel refuses these characters and caps sheet names at 31 characters. */
function sanitiseSheetName(title: string): string {
  return title.replace(/[*?:/\\[\]]/g, " ").slice(0, 31) || "Sheet1";
}

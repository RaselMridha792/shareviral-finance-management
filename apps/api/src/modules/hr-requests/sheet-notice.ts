import { formatMoney, toMinorUnits } from "@finance/shared";

/** A salary sheet a pay change reaches, and what it holds for that person. */
export type ReachedSheet = {
  label: string;
  status: string;
  /** Their line's gross on it, or null when they are not on it. */
  gross: string | null;
  /** Set when that line was cut to the days worked. */
  workingDays: number | null;
};

/**
 * What approving a pay change means for the sheets it reaches (#128).
 *
 * Said from what each sheet HOLDS for that person, not from the salary
 * record: a built line keeps the figure it was built with, whatever the
 * record says since, and a correction approved after a month was paid is
 * exactly when the two differ. Then from what the sheet's state still
 * allows: a draft is built again; a finalised sheet can be reopened while its
 * money has not gone (Mark paid is what writes the books, but a bank advice
 * can send the salaries before it); a paid one is done, and a one-off can
 * only add to it. A sheet that already holds this figure needs nothing said.
 */
export function sheetNotice(
  sheets: ReachedSheet[],
  amount: string,
): string | null {
  const asked = toMinorUnits(amount);
  const groups = new Map<
    string,
    {
      labels: string[];
      state: "draft" | "finalized" | "paid";
      gross: string | null;
      workingDays: number | null;
    }
  >();
  for (const sheet of sheets) {
    if (
      sheet.gross !== null &&
      sheet.workingDays === null &&
      toMinorUnits(sheet.gross) === asked
    ) {
      continue;
    }
    const state =
      sheet.status === "draft"
        ? "draft"
        : sheet.status === "finalized"
          ? "finalized"
          : "paid";
    const key = [state, sheet.gross ?? "", sheet.workingDays ?? ""].join("|");
    const group = groups.get(key);
    if (group) {
      group.labels.push(sheet.label);
    } else {
      groups.set(key, {
        labels: [sheet.label],
        state,
        gross: sheet.gross,
        workingDays: sheet.workingDays,
      });
    }
  }

  const said = [...groups.values()].map(
    ({ labels, state, gross, workingDays }) => {
      const many = labels.length > 1;
      const names = labels.join(", ");
      const holding =
        gross === null
          ? "without them on it"
          : `at ${formatMoney(gross)} for them${workingDays !== null ? ` (${workingDays} days worked)` : ""}`;
      if (state === "draft") {
        return `${names} ${many ? "were" : "was"} built ${holding} — press Build list on ${many ? "each" : "it"} to use this figure.`;
      }
      if (state === "finalized") {
        return `${names} ${many ? "are" : "is"} finalised ${holding} but not marked paid — if the money has not gone to the bank yet, reopen ${many ? "each" : "it"} and press Build list to use this figure.`;
      }
      if (gross !== null && toMinorUnits(gross) > asked) {
        return `${names} ${many ? "are" : "is"} already paid ${holding}, more than this figure; nothing takes an overpayment back on its own, and a one-off can only add pay.`;
      }
      return `${names} ${many ? "are" : "is"} already paid ${holding}; ${gross === null ? "what is owed" : "anything more owed"} for ${many ? "those months" : "that month"} is not paid unless HR sends it as a one-off.`;
    },
  );
  return said.length ? said.join(" ") : null;
}

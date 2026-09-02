"use client";

import { Download } from "lucide-react";
import { useMemo, useState } from "react";

import { useSession } from "@/components/auth/session-provider";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { exportUrl } from "@/lib/ledger";
import type { AccountDto } from "@/lib/masters";
import { cn } from "@/lib/utils";
import { hasPermission, type Permission } from "@finance/shared";

/**
 * Export → pick a dataset, narrow it, download.
 *
 * This is where the export buttons that came off the other screens went. Each
 * one is the same endpoint that button used, so the file is still the list
 * endpoint's own output — which is what makes "the sheet matches what the
 * screen would have shown" a property of the code rather than a promise.
 *
 * Two rules the datasets below encode, and neither is decoration:
 *
 * The controls a dataset offers are exactly the ones its endpoint reads. The
 * query schemas are `strictObject`, so a stray key is a 400 rather than an
 * ignored filter — but the reason to be careful is the quieter one: a date
 * range on a dataset that has no dates would narrow nothing and say nothing,
 * and somebody would take the whole file for a filtered one.
 *
 * And the list is filtered by what this person may already read. That is a
 * courtesy, not the enforcement: every endpoint carries its own
 * `@RequirePermission`, and HR asking for the team's sheet by URL still gets
 * the HR-shaped rows, because the export consumes the service's projected DTOs
 * rather than building its own.
 */

type Control = "dateRange" | "account" | "yearMonth" | "year" | "fiscalYear";

/**
 * What comes down, which is now three different things.
 *
 * The owner asked for a section that produces Windows CSV — *"eta hobe windows
 * CSV format export"* — beside the spreadsheets that were already here, and a
 * bank statement *"Sundor Ekta Graphical PDF version a"*. Three formats on one
 * screen with nothing saying which is which is how somebody mails a colleague
 * an .xlsx they cannot open, so the format is on the card, on the section
 * heading, and on the button.
 */
type Format = "sheet" | "csv" | "pdf";

const FORMATS: Record<
  Format,
  { badge: string; heading: string; blurb: string }
> = {
  sheet: {
    badge: "XLSX",
    heading: "Spreadsheets",
    blurb: "Excel workbooks. Figures come out as numbers, so they still sum.",
  },
  csv: {
    badge: "CSV",
    heading: "CSV for Windows",
    blurb:
      "Plain comma-separated text, written the way Excel on Windows reads it — " +
      "so Bangla names arrive as Bangla rather than as mojibake.",
  },
  pdf: {
    badge: "PDF",
    heading: "Documents",
    blurb: "Laid out to be read and sent, rather than reconciled against.",
  },
};

type Dataset = {
  id: string;
  label: string;
  detail: string;
  format: Format;
  permission: Permission;
  controls: Control[];
  /** The path under `/exports`, given whatever the controls collected. */
  target: (state: FormState) => string | null;
  /** Only the keys this endpoint's schema accepts. */
  query: (state: FormState) => Record<string, string | number | undefined>;
};

type FormState = {
  from: string;
  to: string;
  accountId: string;
  year: string;
  month: string;
  fiscalYear: string;
};

const DATASETS: Dataset[] = [
  /* --- CSV for Windows ------------------------------------------------- */
  {
    id: "team-mail",
    label: "Team member mail list",
    detail:
      "Id, Name, Department and Email Address — the four columns a mail merge reads. " +
      "People with no address on file are left out; a blank address is not a recipient.",
    format: "csv",
    permission: "team.read",
    controls: [],
    target: () => "team-members/mail.csv",
    query: () => ({}),
  },

  /* --- documents -------------------------------------------------------- */
  {
    id: "bank-statement-pdf",
    label: "Bank statement",
    detail:
      "One account's period as a document: the position on the cover, how the balance " +
      "moved, where the money went, then the line-by-line.",
    format: "pdf",
    permission: "accounts.read",
    controls: ["account", "dateRange"],
    target: (s) => (s.accountId ? `register/${s.accountId}/statement.pdf` : null),
    query: (s) => ({ from: s.from || undefined, to: s.to || undefined }),
  },

  /* --- spreadsheets ----------------------------------------------------- */
  {
    id: "transactions",
    label: "All transactions",
    detail: "Every entry in the ledger, in and out, across all accounts.",
    format: "sheet",
    permission: "transactions.read",
    controls: ["dateRange"],
    target: () => "transactions",
    query: (s) => ({ from: s.from || undefined, to: s.to || undefined }),
  },
  {
    id: "register",
    label: "One account's register",
    detail:
      "The bank statement: one account's movements in date order, with the running balance.",
    format: "sheet",
    permission: "accounts.read",
    controls: ["account", "dateRange"],
    target: (s) => (s.accountId ? `register/${s.accountId}` : null),
    query: (s) => ({ from: s.from || undefined, to: s.to || undefined }),
  },
  {
    id: "accounts",
    label: "Accounts",
    detail: "Every account with its opening balance and what it holds now.",
    format: "sheet",
    permission: "accounts.read",
    controls: [],
    target: () => "accounts",
    query: () => ({}),
  },
  {
    id: "subscriptions",
    label: "AI tools and subscriptions",
    detail: "Every paid plan, what it costs, who is on it, and which card renews it.",
    format: "sheet",
    permission: "vendors.read",
    controls: [],
    target: () => "subscriptions",
    query: () => ({}),
  },
  {
    id: "team-members",
    label: "Team directory",
    detail: "Everybody on the team, with what the reader is allowed to see.",
    format: "sheet",
    permission: "team.read",
    controls: [],
    target: () => "team-members",
    query: () => ({}),
  },
  {
    id: "team-data-sheet",
    label: "Team member data sheet",
    detail:
      "The full personnel record: identity, contact, emergency, bank, tax and education — " +
      "every field the profile screen holds.",
    format: "sheet",
    permission: "team.read",
    controls: [],
    target: () => "team-members/data-sheet",
    query: () => ({}),
  },
  {
    id: "tds-liability",
    label: "TDS deducted from salary",
    detail: "Who was deducted from, and how much, over a month or a year.",
    format: "sheet",
    permission: "tds.read",
    controls: ["yearMonth"],
    target: () => "tds/liability",
    query: (s) => ({
      year: s.year || undefined,
      month: s.month || undefined,
    }),
  },
  {
    id: "tds-deposits",
    label: "TDS challans",
    detail: "What has been deposited to the treasury, and against which month.",
    format: "sheet",
    permission: "tds.read",
    controls: ["year"],
    target: () => "tds/deposits",
    query: (s) => ({ year: s.year || undefined }),
  },
  {
    id: "tds-returns",
    label: "Withholding returns",
    detail: "The quarterly filings for one fiscal year.",
    format: "sheet",
    permission: "tds.read",
    controls: ["fiscalYear"],
    target: () => "tds/returns",
    query: (s) => ({ fiscalYear: s.fiscalYear || undefined }),
  },
  {
    id: "income-tax",
    label: "Income tax records",
    detail: "Advance tax, returns and assessments.",
    format: "sheet",
    permission: "incometax.read",
    controls: [],
    target: () => "income-tax",
    query: () => ({}),
  },
];

/** This year, for the year and fiscal-year boxes to start somewhere sensible. */
const THIS_YEAR = new Date().getFullYear();

export function ExportPanel({ accounts }: { accounts: AccountDto[] }) {
  const { role } = useSession();
  const canExport = hasPermission(role, "exports.run");

  // Hooks before any early return: a component that returns before its state
  // is declared changes hook order the moment the permission does.
  const [chosen, setChosen] = useState<string>(DATASETS[0].id);
  const [state, setState] = useState<FormState>({
    from: "",
    to: "",
    accountId: "",
    year: String(THIS_YEAR),
    month: "",
    fiscalYear: String(THIS_YEAR),
  });

  /*
   * The role once, then plain function calls.
   *
   * The first version called `useCan` inside a `.map` over the datasets and
   * silenced the hooks rule with a comment. The count happens to be constant,
   * so it would have worked — but suppressing that warning to keep a loop is
   * how a real violation gets added later without anything objecting.
   * `hasPermission` is the same check `useCan` makes, and it is an ordinary
   * function.
   */
  const allowed = useMemo(
    () => DATASETS.filter((d) => hasPermission(role, d.permission)),
    [role],
  );

  const dataset = allowed.find((d) => d.id === chosen) ?? allowed[0];

  if (!canExport) {
    return (
      <Card className="px-5 py-4">
        <p className="text-sm text-muted-foreground">
          Exporting is not part of your role.
        </p>
      </Card>
    );
  }

  if (!dataset) {
    return (
      <Card className="px-5 py-4">
        <p className="text-sm text-muted-foreground">
          There is nothing here you have permission to export.
        </p>
      </Card>
    );
  }

  const target = dataset.target(state);
  const set = (patch: Partial<FormState>) =>
    setState((current) => ({ ...current, ...patch }));

  function download() {
    if (!target) return;
    // Straight to the browser rather than through `apiFetch`: the server names
    // and streams the file, and the cookie goes with a top-level navigation.
    window.location.href = exportUrl(target, dataset!.query(state));
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          title="What to export"
          description="One dataset per file. Every column comes out."
        />
        <CardBody className="flex flex-col gap-6">
          {/*
            Grouped by what lands on the disk, not by subject. Somebody comes
            to this screen wanting either a file to work in or a file to send,
            and that is the first fork — a CSV sitting unlabelled between nine
            workbooks is the one that gets picked by mistake.
          */}
          {(["csv", "pdf", "sheet"] as Format[]).map((format) => {
            const entries = allowed.filter((entry) => entry.format === format);
            if (entries.length === 0) return null;
            const meta = FORMATS[format];

            return (
              <section key={format} className="flex flex-col gap-2">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    {meta.heading}
                    <FormatBadge format={format} />
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {meta.blurb}
                  </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {entries.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => setChosen(entry.id)}
                      aria-pressed={entry.id === dataset.id}
                      className={cn(
                        "cursor-pointer rounded-lg border px-3 py-2.5 text-left transition",
                        entry.id === dataset.id
                          ? "border-primary bg-primary/10"
                          : "border-border hover:bg-surface-muted",
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "block text-sm",
                            entry.id === dataset.id
                              ? "font-medium text-primary"
                              : "",
                          )}
                        >
                          {entry.label}
                        </span>
                        <FormatBadge format={entry.format} />
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {entry.detail}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Narrow it"
          description={
            dataset.controls.length === 0
              ? "This one comes out whole — it has nothing to narrow by."
              : "Leave a box empty to leave that end open."
          }
        />
        <CardBody className="flex flex-col gap-4">
          {dataset.controls.includes("account") ? (
            <Field
              label="Account"
              hint="A register is one account's, so this one is required."
            >
              <Select
                value={state.accountId}
                onChange={(e) => set({ accountId: e.target.value })}
              >
                <option value="">Choose an account…</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {dataset.controls.includes("dateRange") ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="From">
                <Input
                  type="date"
                  value={state.from}
                  onChange={(e) => set({ from: e.target.value })}
                />
              </Field>
              <Field label="To">
                <Input
                  type="date"
                  value={state.to}
                  onChange={(e) => set({ to: e.target.value })}
                />
              </Field>
            </div>
          ) : null}

          {dataset.controls.includes("yearMonth") ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Year" hint="Required for this one.">
                <Input
                  type="number"
                  value={state.year}
                  min={2000}
                  max={2200}
                  onChange={(e) => set({ year: e.target.value })}
                />
              </Field>
              <Field label="Month" hint="Leave empty for the whole year.">
                <Select
                  value={state.month}
                  onChange={(e) => set({ month: e.target.value })}
                >
                  <option value="">The whole year</option>
                  {MONTHS.map((name, index) => (
                    <option key={name} value={index + 1}>
                      {name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          ) : null}

          {dataset.controls.includes("year") ? (
            <Field label="Year" hint="Leave empty for every year.">
              <Input
                type="number"
                value={state.year}
                min={2000}
                max={2200}
                onChange={(e) => set({ year: e.target.value })}
              />
            </Field>
          ) : null}

          {dataset.controls.includes("fiscalYear") ? (
            <Field
              label="Fiscal year"
              hint="The starting calendar year — 2026 means July 2026 to June 2027."
            >
              <Input
                type="number"
                value={state.fiscalYear}
                min={2000}
                max={2200}
                onChange={(e) => set({ fiscalYear: e.target.value })}
              />
            </Field>
          ) : null}

          <div>
            <Button onClick={download} disabled={!target}>
              <Download className="size-3.5" />
              Download {dataset.label.toLowerCase()} (
              {FORMATS[dataset.format].badge})
            </Button>
          </div>

          {!target ? (
            <p className="text-xs text-warning">
              Choose an account first — a register belongs to one.
            </p>
          ) : null}

          <p className="text-xs text-muted-foreground">
            The file is what the matching screen would have shown you, with the
            same permissions applied — which is why there is no column picker
            here. A sheet assembled from a different query is a sheet that can
            disagree with the app.
          </p>

          {dataset.format === "csv" ? (
            <p className="text-xs text-muted-foreground">
              Written for Excel on Windows: a byte-order mark so Bangla names
              open as Bangla, and CRLF line endings. It opens the same
              everywhere else.
            </p>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * The three letters that say what will land on the disk.
 *
 * On the card and on the section heading both — a reader who has already
 * scrolled past the heading is exactly the one about to click the wrong thing.
 */
function FormatBadge({ format }: { format: Format }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
        format === "csv"
          ? "bg-warning/15 text-warning"
          : format === "pdf"
            ? "bg-negative/15 text-negative"
            : "bg-surface-muted text-muted-foreground",
      )}
    >
      {FORMATS[format].badge}
    </span>
  );
}

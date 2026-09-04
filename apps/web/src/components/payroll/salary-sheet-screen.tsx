"use client";

import {
  calculateTds,
  fromMinorUnits,
  PAYMENT_MODES,
  PAYMENT_MODE_LABELS,
  PAYROLL_STATUS_LABELS,
  todayInDhaka,
  toMinorUnits,
} from "@finance/shared";
import {
  ArrowLeft,
  Calculator,
  CircleCheck,
  LoaderCircle,
  Lock,
  Printer,
  RefreshCw,
  Save,
  TriangleAlert,
  Unlock,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { useNameThisPage } from "@/components/layout/breadcrumb";
import { useCan } from "@/components/auth/session-provider";
import { MemberPicker } from "@/components/payroll/member-picker";
import { RunDocuments } from "@/components/payroll/run-documents";
import { TdsWorking } from "@/components/tds/tds-working";
import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { DateInput, Field, Input, Select } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/overlay";
import { PageHeader } from "@/components/ui/page-header";
import { SerialCell, SerialHead, TableScroll, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api-client";
import type { AccountDto } from "@/lib/masters";
import {
  payrollApi,
  type EligibleMemberDto,
  teamApi,
  type PayrollLineDto,
  type PayrollRunDto,
} from "@/lib/payroll";
import { cn } from "@/lib/utils";

/*
 * No `usdRate` prop any more.
 *
 * The sheet used to be handed the app's one governing rate and print it on
 * every row. Each line now carries its own, typed here, so the screen has
 * nothing to ask the FX module for — and the page below it stopped fetching a
 * rate it no longer passes anywhere.
 */
export function SalarySheetScreen({
  run,
  lines,
  accounts,
}: {
  run: PayrollRunDto;
  lines: PayrollLineDto[];
  accounts: AccountDto[];
}) {
  // The rail knows the ancestors; only this page knows the record.
  useNameThisPage(run.label);

  const router = useRouter();
  const canWrite = useCan("payroll.write");
  const canPay = useCan("payroll.pay");
  // Writing a compensation record is a pay decision, not a payroll one.
  const canSetPay = useCan("team.compensation.write");
  // `exports.run` alone is not enough for a file of salary figures — HR holds
  // it and does not hold payroll.read.

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [reopening, setReopening] = useState(false);
  /*
   * Which line's tax working is open — held here, not on the row.
   *
   * It used to be a `useState` inside `LineRow`, so the drawer was rendered
   * inside the `<td>` the figure sits in. A drawer is `position: fixed`, so it
   * LOOKED right, and every diff read fine — but `white-space` inherits down
   * the DOM regardless of where an element is painted, and
   * `.table-data th, td { white-space: nowrap }` therefore reached the whole
   * panel. Its labels could not wrap, so a line reading "Rebate — on
   * investment 39,000.00, on income 12,000.00, ceiling 10,000.00" forced the
   * panel's content to 833px inside a 447px drawer and the figures ran off the
   * right-hand edge. That is the fault in the owner's screenshot.
   *
   * Out here the panel inherits the page, one drawer exists instead of one per
   * row, and the next drawer somebody mounts inside a cell will not repeat it.
   */
  const [workingFor, setWorkingFor] = useState<PayrollLineDto | null>(null);
  const toast = useToast();

  const draft = run.status === "draft";
  const refresh = () => router.refresh();

  /*
   * The owner's rule: who is on the month stays choosable for as long as the
   * run is a draft. The drawer holds the same checklist the start-a-month
   * form shows, seeded with who is on the sheet now; saving makes the run
   * hold exactly the ticked set, and the lines of everyone kept are not
   * touched — bonuses, breakdowns and all.
   */
  const [choosingPeople, setChoosingPeople] = useState(false);
  const [eligible, setEligible] = useState<EligibleMemberDto[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!choosingPeople) return;
    let stale = false;
    // Read-on-open, the same exemption every panel that does this takes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEligible(null);
    setChosen(new Set(lines.map((line) => line.teamMemberId)));
    payrollApi
      .eligible(run.periodYear, run.periodMonth)
      .then((people) => {
        if (!stale) setEligible(people);
      })
      .catch(() => {
        if (!stale) setEligible([]);
      });
    return () => {
      stale = true;
    };
  }, [choosingPeople, lines, run.periodYear, run.periodMonth]);

  /**
   * The parts a gross is divided into, taken from the sheet rather than from
   * Settings.
   *
   * Settings holds the rule as it is *today*; these lines were frozen when the
   * month was built. Reading the columns off the lines means an old sheet keeps
   * the headings it was made with, and a sheet where somebody has edited one
   * person's breakdown by hand still shows every part that exists in it.
   *
   * First-seen order, so the columns run Basic, House Rent, Conveyance,
   * Medical — the order the rule is written in — rather than alphabetically.
   */
  const splitLabels = useMemo(() => {
    const seen: string[] = [];
    for (const line of lines) {
      for (const part of line.earningsBreakdown ?? []) {
        if (!seen.includes(part.label)) seen.push(part.label);
      }
    }
    /*
     * The owner's sheet reads Basic, House Rent, Medical, Conveyance — so
     * that is the order here, whatever order the parts were recorded in.
     * A label the preference does not know keeps its first-seen place at
     * the end rather than vanishing.
     */
    const preferred = ["Basic", "House Rent", "Medical", "Conveyance"];
    const rank = (label: string) => {
      const i = preferred.findIndex((p) => label.startsWith(p));
      return i === -1 ? preferred.length : i;
    };
    return [...seen].sort((a, b) => rank(a) - rank(b));
  }, [lines]);

  /** The month's own calendar length — the Working Days column's "out of". */
  const daysInMonth = new Date(
    Date.UTC(run.periodYear, run.periodMonth, 0),
  ).getUTCDate();

  /** Each part summed down the sheet, for the heading's share and the total. */
  const splitTotals = useMemo(() => {
    const sums: Record<string, string> = {};
    for (const label of splitLabels) {
      let minor = BigInt(0);
      for (const line of lines) {
        const part = line.earningsBreakdown?.find((p) => p.label === label);
        if (part) minor += toMinorUnits(part.amount);
      }
      sums[label] = fromMinorUnits(minor);
    }
    return sums;
  }, [lines, splitLabels]);

  /**
   * The three columns the run does not carry a total for.
   *
   * `run` has gross, tax and net; bonus and the two "other" columns were left
   * blank in the totals row. A column of figures with no total under it is a
   * column somebody adds up by hand.
   */
  const totals = useMemo(() => {
    const sum = (pick: (line: PayrollLineDto) => string) =>
      fromMinorUnits(
        lines.reduce((acc, line) => acc + toMinorUnits(pick(line)), BigInt(0)),
      );
    return {
      bonus: sum((line) => line.bonusAmount),
      otherAdditions: sum((line) => line.otherAdditions),
      otherDeductions: sum((line) => line.otherDeductions),
    };
  }, [lines]);

  /**
   * The sheet in dollars, added up line by line.
   *
   * There is no longer one rate to divide the month's net by — every line
   * carries its own — so the total is the sum of what each line is actually
   * worth, and lines with no rate are counted separately rather than silently
   * left out. A dollar figure quietly missing four people is worse than no
   * dollar figure at all.
   *
   * Kept in floating point deliberately, unlike every other total here: this
   * one is a translation of a figure that is already exact in taka, shown with
   * a "≈" in front of it. The taka totals are summed in minor units because
   * they are the ones somebody pays.
   */
  const usdTotal = useMemo(() => {
    let amount = 0;
    let without = 0;
    let counted = 0;
    for (const line of lines) {
      const rate = Number(line.fxRate);
      if (!line.fxRate || !Number.isFinite(rate) || rate <= 0) {
        without += 1;
        continue;
      }
      amount += Number(line.netAmount) / rate;
      counted += 1;
    }
    return counted === 0 ? null : { amount, without };
  }, [lines]);

  /**
   * Commits whatever is still being typed, and says so.
   *
   * Blurring the focused cell fires the same per-field save the sheet already
   * does, so this adds no second way for a figure to reach the server — one
   * path, one audit row, no chance of the two disagreeing. What it adds is the
   * acknowledgement, which is the part that was missing.
   */
  function saveDraft() {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    toast.show("Draft saved. Nothing is locked until you finalise.");
  }

  /**
   * Who the last build left out, because they have no pay on record.
   *
   * Kept so the screen can offer the way forward instead of only naming the
   * problem. The message alone read as a failure with no remedy — and the
   * remedy was eighteen profiles, opened one at a time.
   */
  const [skipped, setSkipped] = useState<string[]>([]);

  async function act(fn: () => Promise<unknown>, message?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await fn();
      const withMessage = result as
        { message?: string; skipped?: string[] } | undefined;
      setNotice(withMessage?.message ?? message ?? null);
      setSkipped(withMessage?.skipped ?? []);
      refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Something went wrong.",
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Set the missing pay records from what each person was hired at.
   *
   * Offered here because here is where the gap is discovered. It writes real
   * compensation records dated from each person's own joining date, so an
   * earlier month computes correctly too — and it never touches anybody who
   * already has a figure.
   */
  async function setPayFromJoining() {
    setBusy(true);
    setError(null);
    try {
      const result = await teamApi.setPayFromJoiningSalary();
      if (!result.created) {
        setNotice(
          result.skipped.length
            ? `No joining salary is recorded for ${result.skipped.join(", ")}, so there is nothing to copy. Set their pay on the Team page.`
            : "Everybody already has pay on record.",
        );
        setSkipped([]);
      } else {
        setNotice(
          `Pay set for ${result.created} ${result.created === 1 ? "person" : "people"} from their joining salary. Build the list again.` +
            (result.skipped.length
              ? ` Still without a figure: ${result.skipped.join(", ")}.`
              : ""),
        );
        setSkipped(result.skipped);
      }
      refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not set pay.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Link
        href="/payroll"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All payroll runs
      </Link>

      <PageHeader
        title={`Salary sheet — ${run.label}`}
        icon="table_view"
        description={`${lines.length} people · ${PAYROLL_STATUS_LABELS[run.status]}`}
        actions={
          <>
            {canWrite && draft ? (
              <Button
                variant="secondary"
                size="md"
                disabled={busy}
                onClick={() => setChoosingPeople(true)}
              >
                <Users className="size-4" />
                People
              </Button>
            ) : null}
            {canWrite && draft ? (
              <Button
                variant="secondary"
                size="md"
                disabled={busy}
                onClick={() => act(() => payrollApi.generateLines(run.id))}
              >
                <RefreshCw className="size-4" />
                {lines.length ? "Rebuild list" : "Build list"}
              </Button>
            ) : null}
            {/*
              Separate from Rebuild, because rebuilding starts the sheet again
              and loses the bonuses and breakdowns typed since. The reason to
              want this is usually that the rates were published after the
              sheet was built.
            */}
            {canWrite && draft && lines.length ? (
              <Button
                variant="secondary"
                size="md"
                disabled={busy}
                onClick={() => act(() => payrollApi.recalculateTds(run.id))}
              >
                <Calculator className="size-4" />
                Work out the tax again
              </Button>
            ) : null}
            {/*
              Save draft.

              The cells already save one at a time as you leave them, and that
              stays — eighteen people's tax figures typed against one Save
              button is eighteen people's work to lose. But a sheet that saves
              invisibly gives somebody no way to know it did, and the honest
              answer to "have my figures gone in" was previously to reload the
              page and look.

              So the button does the two things that are actually true: it
              commits whatever cell is still being typed in (blurring fires the
              same save the cell already does), and it says so. It is
              deliberately not the thing that persists the sheet — claiming
              that would be a lie about where the work is done.
            */}
            {canWrite && draft && lines.length > 0 ? (
              <Button
                variant="secondary"
                size="md"
                disabled={busy}
                onClick={saveDraft}
              >
                <Save className="size-4" />
                Save draft
              </Button>
            ) : null}
            {canWrite && draft && lines.length > 0 ? (
              <Button
                variant="primary"
                size="md"
                disabled={busy}
                onClick={() =>
                  act(() => payrollApi.finalize(run.id), "Figures locked.")
                }
              >
                <Lock className="size-4" />
                Finalise
              </Button>
            ) : null}
            {/*
              Reopen, on a paid run as well as a finalised one.

              It used to appear only on `finalized`, which left a paid run with
              no way back and nothing on screen saying why. The server has
              always allowed both — it asks the ledger rather than the status,
              so a run whose entries have all been voided reopens, and one with
              money still out is refused with a message naming how many entries
              are live and where to void them.

              Showing the button on a paid run is therefore not a shortcut past
              the rule; it is what makes the rule visible. Pressing it either
              works, because nothing is out, or explains itself.
            */}
            {canWrite &&
            (run.status === "finalized" || run.status === "paid") ? (
              <Button
                variant="secondary"
                size="md"
                disabled={busy}
                onClick={() =>
                  run.status === "paid"
                    ? setReopening(true)
                    : act(() => payrollApi.reopen(run.id), "Open for editing.")
                }
              >
                <Unlock className="size-4" />
                {run.status === "paid" ? "Edit" : "Reopen"}
              </Button>
            ) : null}
            {canPay && run.status === "finalized" ? (
              <Button
                variant="primary"
                size="md"
                onClick={() => setPaying(true)}
              >
                <CircleCheck className="size-4" />
                Mark paid
              </Button>
            ) : null}
          </>
        }
      />

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
        >
          {error}
        </p>
      ) : null}

      {notice ? (
        <div className="flex flex-col gap-3 rounded-lg bg-warning/10 px-3 py-2.5 text-sm text-muted-foreground">
          <p>{notice}</p>

          {/*
            The way out, next to the problem.

            The sheet reads compensation_history — what somebody earns now.
            An imported team member carries only the salary agreed at hire,
            which is a different fact and deliberately not used for pay on its
            own: it can be years old, and a run that quietly pays a 2024 figure
            is a wrong payment nobody notices. So it is offered as something a
            person does, once, and every record it writes names the amount in
            the audit log.
          */}
          {skipped.length && draft && canSetPay ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={setPayFromJoining}
              >
                Set their pay from the joining salary
              </Button>
              <span className="text-xs">
                Dated from each person&apos;s own joining date. Anyone who
                already has a figure is left alone.
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Figure label="Gross" value={run.totalGross} />
        <Figure label="Additions" value={run.totalAdditions} />
        <Figure
          label="Tax withheld"
          value={run.totalTds}
          hint="Stays with you until the challan is deposited"
        />
        <Figure label="Net to pay" value={run.totalNet} emphasis />
      </div>

      {/*
        This month's paperwork, beside this month's totals.

        It sits above the table rather than under it because a sheet is twenty
        rows long and anything below them is found by nobody. And it is on the
        run rather than on the salary transaction the run writes when it is
        paid, so that it can be filled while the sheet is still a draft — which
        is when the owner asked for it: *"payroll toiri korar somoy invoice and
        reference upload korar option tao diye diyo"*.
      */}
      <Card className="flex flex-col gap-3 p-5">
        <div>
          <h2 className="text-sm font-semibold">Documents</h2>
          <p className="text-xs text-muted-foreground">
            The invoice for this month and the bank&apos;s record of paying it.
            Either can be added later.
          </p>
        </div>
        <RunDocuments runId={run.id} canWrite={canWrite} />
      </Card>

      {run.status === "draft" ? (
        <div className="flex items-start gap-3 rounded-lg bg-surface-muted px-4 py-3">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Nothing has left the bank. Type each person&apos;s tax into the
            table, finalise to lock the figures, then mark it paid — that last
            step is what creates the ledger entry.
          </p>
        </div>
      ) : null}

      {lines.length === 0 ? (
        <Card className="px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            The list is empty. Build it to pull in everyone employed this month
            at the pay they were on.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <TableScroll>
            {/* One column wider than it was — the SL somebody reads a row out
                by — so the money columns keep the width they had. */}
            <table className="table-data min-w-[1560px] text-sm">
              <thead>
                <tr>
                  {/* The owner's own sheet, column for column: name, role,
                      dept, the four parts, bonus and other additions, the
                      working days, and only then the gross they add up to,
                      the tax, the net, and the net said in dollars. Other −
                      is the one column the sheet does not carry, kept because
                      it still moves the net — a figure that counts but cannot
                      be seen is the class of bug this app hunts. */}
                  <SerialHead />
                  <Th>Name</Th>
                  <Th>Role</Th>
                  <Th>Dept</Th>
                  {splitLabels.map((label) => (
                    <Th key={label} width="w-24" align="right">
                      {label}
                      {/* Under the name, not beside it. Beside it, "House Rent
                          30%" set the column's width from a heading rather
                          than from the figures, and four of those pushed Net
                          off the edge of the card. */}
                      <span className="num block font-normal normal-case opacity-70">
                        {shareOfGross(splitTotals[label], run.totalGross)}
                      </span>
                    </Th>
                  ))}
                  <Th width="w-28" align="right">
                    Bonus
                  </Th>
                  <Th width="w-28" align="right">
                    Other +
                  </Th>
                  <Th width="w-24" align="right">
                    Working Days
                    <span className="num block font-normal normal-case opacity-70">
                      of {daysInMonth}
                    </span>
                  </Th>
                  <Th width="w-28" align="right">
                    Gross
                  </Th>
                  {/* Wider than its neighbours because it carries two things:
                      the box somebody types the tax into, and the button onto
                      the working behind it. */}
                  <Th width="w-36" align="right">
                    TDS
                  </Th>
                  <Th width="w-28" align="right">
                    Other −
                  </Th>
                  <Th width="w-32" align="right">
                    Net Pay
                  </Th>
                  <Th width="w-24" align="right">
                    FX Rate
                  </Th>
                  <Th width="w-28" align="right">
                    Net Pay (USD)
                  </Th>
                  <Th width="w-24" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <LineRow
                    key={line.id}
                    n={index + 1}
                    line={line}
                    splitLabels={splitLabels}
                    daysInMonth={daysInMonth}
                    editable={canWrite && draft}
                    onSaved={refresh}
                    onShowWorking={() => setWorkingFor(line)}
                  />
                ))}
              </tbody>
              {/*
                One cell per column, in the columns' own order.

                It was written as a run of colSpans that added up to nine cells
                for an eight-column table, which put every total one column to
                the right of the figures it totalled — the gross under Bonus,
                the tax under Other −. Nobody had seen it because a tfoot needs
                a finalised run to exist. Spelled out now, so adding a column
                cannot silently shift it again.

                Counted by hand against the head: 2 (Total, over SL and Name)
                + 1 gross + splitLabels.length + 5 (bonus, other +, tax,
                other −, net) + 1 blank = 9 + splitLabels.length. The head emits
                SL, Name, Gross, the splits, those same five and the actions
                column — 9 + splitLabels.length.
              */}
              <tfoot>
                <tr>
                  {/* Counted by hand against the head, as the note above
                      demands: 4 (Total, over SL/Name/Role/Dept) + the splits
                      + bonus + other+ + blank days + gross + tds + other− +
                      net + blank fx + usd net + blank actions. */}
                  <td colSpan={4} className="font-semibold">
                    Total
                  </td>
                  {splitLabels.map((label) => (
                    <FootAmount key={label} value={splitTotals[label] ?? "0"} />
                  ))}
                  <FootAmount value={totals.bonus} />
                  <FootAmount value={totals.otherAdditions} />
                  <td />
                  <FootAmount value={run.totalGross} />
                  <FootAmount value={run.totalTds} />
                  <FootAmount value={totals.otherDeductions} />
                  <FootAmount value={run.totalNet} />
                  <td />
                  {/*
                    Added up from the lines, not the total net divided by a
                    rate — there is no longer one rate to divide by. A line
                    with no rate contributes nothing and the figure says how
                    many those are, because a dollar total quietly missing four
                    people is worse than no dollar total.
                  */}
                  <td className="col-amount">
                    {usdTotal === null
                      ? "N/A"
                      : `≈ $${usdTotal.amount.toFixed(2)}${
                          usdTotal.without > 0
                            ? ` (${usdTotal.without} without a rate)`
                            : ""
                        }`}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </TableScroll>
        </Card>
      )}

      <TdsWorkingDrawer
        line={workingFor}
        onClose={() => setWorkingFor(null)}
      />

      <PayForm
        open={paying}
        run={run}
        accounts={accounts}
        onClose={() => setPaying(false)}
        onPaid={refresh}
      />

      {/*
        Editing a run the money has already left on.

        Not a warning bolted onto a button that would have worked anyway — the
        server decides, and it decides by counting live ledger entries rather
        than by reading the status. This says what the two outcomes are before
        somebody presses it, so the refusal is not a surprise.
      */}
      <ConfirmDialog
        open={reopening}
        title="Edit a run that has already been paid?"
        confirmLabel="Try to reopen"
        body={
          <>
            This run was marked paid, so there are ledger entries against it and
            money has left the bank. Reopening it is only possible once those
            entries have been voided on the transaction list — the figures on a
            salary sheet and the payment made from it are not allowed to
            disagree.
            <span className="mt-2 block">
              If anything is still live, nothing will change and you will be
              told how many entries there are.
            </span>
          </>
        }
        onConfirm={() => {
          setReopening(false);
          void act(() => payrollApi.reopen(run.id), "Open for editing.");
        }}
        onCancel={() => setReopening(false)}
      />

      <Drawer
        open={choosingPeople}
        onClose={() => setChoosingPeople(false)}
        title="Who is on this month"
        description="Tick somebody to add them, untick to take them off. People who stay keep every figure typed for them."
      >
        <MemberPicker
          eligible={eligible}
          selected={chosen}
          onToggle={(id) =>
            setChosen((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onAll={() =>
            setChosen(
              new Set(
                (eligible ?? [])
                  .filter((p) => p.monthlyGross !== null)
                  .map((p) => p.id),
              ),
            )
          }
          onNone={() => setChosen(new Set())}
        />
        <div className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setChoosingPeople(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={busy}
            onClick={() => {
              setChoosingPeople(false);
              void act(
                () => payrollApi.syncMembers(run.id, [...chosen]),
                "The list now holds exactly the people you ticked.",
              );
            }}
          >
            Save the list
          </Button>
        </div>
      </Drawer>
    </>
  );
}

function LineRow({
  n,
  line,
  splitLabels,
  daysInMonth,
  editable,
  onSaved,
  onShowWorking,
}: {
  /** The row's place on the sheet — the number a figure gets read out by. */
  n: number;
  line: PayrollLineDto;
  /** The sheet's columns, so every row puts its parts under the same ones. */
  splitLabels: string[];
  /** The month's own calendar length — what Working Days is out of. */
  daysInMonth: number;
  editable: boolean;
  onSaved: () => void;
  /** Ask the sheet to open this line's tax working. */
  onShowWorking: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * What the row's boxes hold RIGHT NOW, so Net Pay can follow them.
   *
   * Net is a generated column — gross + bonus + other additions − tax − other
   * deductions — and the server recomputes it on every save. Between typing
   * and blurring, though, the cell beside the box still showed the figure from
   * the last save, so a gross of 116,078 could sit next to a net of 116,129
   * and the sheet appeared to contradict itself. The owner read exactly that
   * off the screen.
   *
   * Seeded from the line and reset whenever the line changes, so a value the
   * server worked out always wins over a stale keystroke.
   */
  const stored = {
    grossAmount: line.grossAmount,
    bonusAmount: line.bonusAmount,
    otherAdditions: line.otherAdditions,
    tdsAmount: line.tdsAmount,
    otherDeductions: line.otherDeductions,
  };
  const [draft, setDraft] = useState(stored);
  const [seenLine, setSeenLine] = useState(line);
  if (seenLine !== line) {
    setSeenLine(line);
    setDraft(stored);
  }

  /** The net the boxes currently come to. Falls back to the stored figure. */
  const liveNet = (() => {
    const n = (v: string) => {
      const parsed = Number(String(v).replace(/[,\s৳]/g, ""));
      return Number.isFinite(parsed) ? parsed : null;
    };
    const parts = [
      n(draft.grossAmount),
      n(draft.bonusAmount),
      n(draft.otherAdditions),
      n(draft.tdsAmount),
      n(draft.otherDeductions),
    ];
    if (parts.some((v) => v === null)) return line.netAmount;
    const [gross, bonus, additions, tds, deductions] = parts as number[];
    return (gross + bonus + additions - tds - deductions).toFixed(2);
  })();

  /** Called as a money box is typed in, before it is saved. */
  const onLive = (field: string, value: string) =>
    setDraft((current) =>
      field in current ? { ...current, [field]: value } : current,
    );

  /*
   * Days are a number or nothing, not an amount — their own path, because
   * `save` sends strings and the contract rightly refuses "10" for a day
   * count. The month's own length typed in means a full month, which is the
   * same thing as clearing the box, and both are sent as null.
   */
  async function saveDays(raw: string) {
    setSaving(true);
    setError(null);
    try {
      const days =
        raw === "" || Number(raw) === daysInMonth ? null : Number(raw);
      const result = await payrollApi.updateLine(line.id, {
        workingDays: days,
      });
      setWarning(result.warning ?? null);
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not save that.",
      );
    } finally {
      setSaving(false);
    }
  }

  /*
   * A rate, or nothing. Its own path for the same reason days have one: `save`
   * sends whatever string is in the box, and the contract rightly refuses ""
   * for a number. Emptying the box means "nobody has stated a rate for this
   * line", which is a real answer and has to reach the server as null rather
   * than as a key that was never sent.
   */
  async function saveRate(raw: string) {
    const next = raw.trim() === "" ? null : raw.trim();
    if (next === (line.fxRate ?? null)) return;
    setSaving(true);
    setError(null);
    try {
      const result = await payrollApi.updateLine(line.id, { fxRate: next });
      setWarning(result.warning ?? null);
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not save that.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function save(field: string, value: string) {
    setSaving(true);
    setError(null);
    try {
      const result = await payrollApi.updateLine(line.id, { [field]: value });
      setWarning(result.warning ?? null);
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not save that.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className={cn("row-finance", line.isPaid && "bg-positive/5")}>
      <SerialCell n={n} />
      <td>
        <span className="font-medium">{line.fullName}</span>
        {warning ? (
          <span className="mt-0.5 block text-xs text-warning">{warning}</span>
        ) : null}
        {error ? (
          <span className="mt-0.5 block text-xs text-negative">{error}</span>
        ) : null}
      </td>
      {/* Role and Dept as their own columns, as the owner's sheet has them —
          the snapshots taken when the line was built, so the sheet says what
          was true in its month even after a later transfer. */}
      <td className="text-sm text-muted-foreground">
        {line.snapshotDesignation ?? "N/A"}
      </td>
      <td className="text-sm text-muted-foreground">
        {line.snapshotDepartment ?? "N/A"}
      </td>

      {/*
        Read, not typed. The parts follow the gross by the rule the month was
        built with; the way to change one is the Breakdown drawer, which is
        where an edit gets recorded as an edit rather than as a figure that
        silently stopped matching its own gross.
      */}
      {splitLabels.map((label) => {
        const part = line.earningsBreakdown?.find((p) => p.label === label);
        return (
          <td key={label}>
            {part ? (
              <Amount
                value={part.amount}
                tone="neutral"
                showCounterpart={false}
                className="block"
              />
            ) : (
              <span className="block text-right text-faint">N/A</span>
            )}
          </td>
        );
      })}

      <Cell
        value={line.bonusAmount}
        field="bonusAmount"
        editable={editable}
        onSave={save}
        onLive={onLive}
      />
      <Cell
        value={line.otherAdditions}
        field="otherAdditions"
        editable={editable}
        onSave={save}
        onLive={onLive}
      />
      {/* Days actually worked — typed straight on the sheet. The gross, its
          breakdown and the tax re-figure from it against the month's real
          length; the month's own number (or an emptied box) means a full
          month. */}
      {editable ? (
        <td>
          <input
            key={`days-${line.workingDays ?? "full"}`}
            defaultValue={line.workingDays ?? daysInMonth}
            inputMode="numeric"
            onBlur={(event) => {
              const raw = event.target.value.trim();
              const now = line.workingDays ?? daysInMonth;
              if (raw !== String(now)) void saveDays(raw);
            }}
            className={cn(
              "col-amount h-8 w-full rounded border border-transparent bg-transparent px-2 text-sm outline-none transition",
              "hover:border-border focus-visible:border-primary focus-visible:bg-surface",
            )}
          />
        </td>
      ) : (
        <td className="col-amount">{line.workingDays ?? daysInMonth}</td>
      )}
      <Cell
        value={line.grossAmount}
        field="grossAmount"
        editable={editable}
        onSave={save}
        onLive={onLive}
      />
      <TdsCell
        line={line}
        editable={editable}
        onSave={save}
        onLive={onLive}
        onOpen={onShowWorking}
      />
      <Cell
        value={line.otherDeductions}
        field="otherDeductions"
        editable={editable}
        onSave={save}
        onLive={onLive}
      />
      {/*
        Built like the Tax cell beside it, not like a bare Amount.

        Every other money column on this sheet places its figure through
        something with its own width and padding — the editable cells through
        an `<input class="col-amount w-full px-2">`, Tax through a full-width
        button that ends its contents with `justify-end`. Net was the one
        exception, an Amount dropped straight into the cell, and it measured
        out of line with its own heading.

        Whether that gap was 24px or nothing depended on which script did the
        measuring, which is its own answer: a column whose alignment two
        instruments disagree about is one to build the same way as its
        neighbours rather than one to keep arguing about.
      */}
      <td>
        <div className="flex w-full items-center justify-end px-1">
          <Amount
            value={liveNet}
            tone="neutral"
            className="font-semibold"
          />
        </div>
      </td>
      {/*
        The rate this line is read in dollars at, typed here.

        It used to print the app's ONE governing rate on every row, and the
        dollars were that rate applied to the net. The owner is removing that
        rate from the app entirely — one box that silently restates every
        historical figure the moment somebody edits it — and his instruction
        for this screen was to type it instead: "fx rate take edit option dite
        hobe etake prottekta table a fx rate likhte parbe".

        Editable only while the sheet is a draft, like every other cell here.
        Once a run is finalised its figures are what was filed, and a rate that
        could still move would make a filed month read differently tomorrow.
      */}
      <RateCell value={line.fxRate} editable={editable} onSave={saveRate} />
      <td className="col-amount text-sm text-muted-foreground">
        {line.fxRate
          ? `≈ $${(Number(line.netAmount) / Number(line.fxRate)).toFixed(2)}`
          : "N/A"}
      </td>
      <td>
        <div className="flex items-center justify-end gap-3">
          {saving ? (
            <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
          ) : null}
          {/*
            No Breakdown link, on the owner's word.

            The four figures it opened — basic, house rent, medical, conveyance
            — are already columns on this same row, each with its percentage in
            the heading. A drawer that re-states four visible numbers is a
            second place for them to disagree.
          */}
          {line.isPaid ? (
            <Link
              href={`/payroll/${line.id}/payslip`}
              prefetch={false}
              className="inline-flex items-center gap-1 text-xs text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
            >
              <Printer className="size-3" />
              Payslip
            </Link>
          ) : null}
        </div>

        {/*
          Both drawers have left this cell. The tax working is mounted once by
          the sheet; the breakdown drawer went with the Breakdown link in #30
          and its state had been sitting here unreachable ever since — nothing
          called `setBreakdown(true)`, and the compiler could not say so
          because `onClose` still referred to it.
        */}
      </td>
    </tr>
  );
}

/**
 * The tax, which is no longer typed.
 *
 * A button rather than a figure, because a number somebody cannot check is a
 * number they will not trust — and the whole reason for working it out in the
 * app was so the arithmetic is there to be looked at. The amber mark is for a
 * line with no working behind it: a run from before the app calculated, or an
 * income year with no rule set up.
 */
/**
 * The tax: worked out, and typeable over.
 *
 * *"etato auto fill hobe eksathe ami duita feature cai. mane auto calculate
 * hoye tds bosbe ami caile karota edit o korte parbo."* Both, in one cell.
 *
 * The figure arrives from the year's rule and re-figures whenever the gross or
 * the working days move. Typing into the box replaces it AND marks the line,
 * so the next edit to the same row leaves the typed figure alone instead of
 * silently recomputing over it — the server says so when it holds one back.
 *
 * The mark is drawn, not only stored. A hand-typed figure keeps a dotted amber
 * underline and says so on hover, because the one real cost of making this
 * editable is that a sheet can no longer be read as "all of this came from the
 * rule". Now it can: the ones that did not are visible.
 *
 * The working is still reachable — the small button beside the box — but only
 * where there is one. An eye onto "no rule was applied to this line" is the
 * empty drawer this app keeps taking off its tables.
 */
function TdsCell({
  line,
  editable,
  onSave,
  onLive,
  onOpen,
}: {
  line: PayrollLineDto;
  editable: boolean;
  onSave: (field: string, value: string) => void;
  /** Reported per keystroke so Net Pay follows the tax as it is typed. */
  onLive?: (field: string, value: string) => void;
  onOpen: () => void;
}) {
  const typed = line.tdsManual;

  if (!editable) {
    return (
      <td>
        <button
          type="button"
          onClick={onOpen}
          title={
            typed
              ? "Typed by hand, not worked out from the rule"
              : line.tdsBasis
                ? "How this was worked out"
                : "No rule was applied to this line"
          }
          className={cn(
            "flex w-full cursor-pointer items-center justify-end gap-1.5 rounded-md px-1 py-0.5 transition hover:bg-surface-muted",
            typed && "decoration-warning/70 underline decoration-dotted",
          )}
        >
          <Amount value={line.tdsAmount} tone="neutral" />
        </button>
      </td>
    );
  }

  return (
    <td>
      <div className="flex items-center gap-1">
        <input
          /*
           * Keyed on the figure, so a value the server recomputed after a
           * gross or working-days edit replaces what is in the box. Without
           * the key React keeps the uncontrolled input's own value and the
           * cell shows the old tax against the new gross until a reload —
           * the same trap the working-days box above already answers this way.
           */
          key={`tds-${line.tdsAmount}-${typed ? "typed" : "rule"}`}
          defaultValue={line.tdsAmount}
          inputMode="decimal"
          title={
            typed
              ? "Typed by hand. Work out the tax again to put the rule back."
              : "Worked out from the year's rule. Type over it to set it by hand."
          }
          onChange={(event) => onLive?.("tdsAmount", event.target.value)}
          onBlur={(event) => {
            if (event.target.value !== line.tdsAmount)
              onSave("tdsAmount", event.target.value);
          }}
          className={cn(
            /*
             * `flex-1 min-w-0`, not `w-full`.
             *
             * A flex child at 100% width beside a button in a 112px column
             * squeezes to nothing: the owner found rows where the box could
             * not be clicked into at all — *"jader tds 0 tader okhane edit kora
             * jacchena"* — and it was the calculator beside it taking the
             * space. `min-w-0` is the half that matters; without it a flex
             * child refuses to shrink below its content and pushes its
             * neighbour out instead.
             */
            "col-amount h-8 min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 text-sm outline-none transition",
            "hover:border-border focus-visible:border-primary focus-visible:bg-surface",
            typed &&
              "border-warning/40 underline decoration-warning/70 decoration-dotted underline-offset-4",
          )}
        />
        {line.tdsBasis ? (
          <button
            type="button"
            onClick={onOpen}
            aria-label="How this was worked out"
            title="How this was worked out"
            className="shrink-0 rounded p-1 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
          >
            <Calculator className="size-3.5" />
          </button>
        ) : null}
      </div>
    </td>
  );
}

/**
 * The whole sum behind one person's deduction.
 *
 * Recomputed here from the frozen basis rather than fetched, so what is shown
 * is the arithmetic that produced the stored figure and not a fresh call
 * against whatever the rule says today. If the two ever disagree, that is
 * exactly what somebody needs to see, so the panel says so.
 */
function TdsWorkingDrawer({
  line,
  onClose,
}: {
  /* Null when nothing is open — one prop rather than a line and a flag that
     can disagree about which line is being shown. */
  line: PayrollLineDto | null;
  onClose: () => void;
}) {
  if (!line) return null;
  return <TdsWorkingPanel line={line} onClose={onClose} />;
}

function TdsWorkingPanel({
  line,
  onClose,
}: {
  line: PayrollLineDto;
  onClose: () => void;
}) {
  const basis = line.tdsBasis;
  const result = basis
    ? calculateTds(basis.annualSalary, basis.policy, basis.declaredInvestment)
    : null;
  const agrees = result ? result.monthlyTds === line.tdsAmount : true;

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${line.fullName} — how the tax was worked out`}
      description={
        basis
          ? `Under the ${basis.fiscalYear}-${String(basis.fiscalYear + 1).slice(2)} rule, on twelve times this month's gross`
          : undefined
      }
    >
      {!basis ? (
        <p className="rounded-lg bg-warning/10 px-3 py-2.5 text-sm">
          Nothing was worked out for this line — either it predates the app
          calculating tax, or no rule is set up for that income year. Settings →
          Salary TDS has the form, and then{" "}
          <strong>Work out the tax again</strong> applies it.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {!basis.exactYear ? (
            <p className="rounded-lg bg-warning/10 px-3 py-2.5 text-sm">
              That income year had no rule of its own, so an earlier year&apos;s
              was used.
            </p>
          ) : null}

          {!agrees ? (
            <p className="rounded-lg bg-negative/10 px-3 py-2.5 text-sm">
              The stored figure and this working disagree. What is on the sheet
              is what will be deducted; <strong>Work out the tax again</strong>{" "}
              brings them back together.
            </p>
          ) : null}

          {result ? <TdsWorking result={result} /> : null}

          <p className="text-xs text-muted-foreground">
            The yearly figure is a projection — twelve times this month&apos;s
            gross. A raise changes it from that month on, and the months before
            it are not restated.
          </p>
        </div>
      )}
    </Drawer>
  );
}

/** Edits in place — a payroll sheet is a grid, not twenty separate forms. */
/**
 * A rate, which is not money.
 *
 * Its own cell rather than `Cell`, which renders an `Amount` when it is not
 * editable — and an `Amount` puts a taka sign in front of it. 122.50 taka to
 * the dollar is not ৳122.50, and a currency symbol on a divisor is the kind of
 * small wrongness somebody reads past for a year.
 */
function RateCell({
  value,
  editable,
  onSave,
}: {
  value: string | null;
  editable: boolean;
  onSave: (value: string) => void;
}) {
  if (!editable) {
    return (
      <td className="col-amount text-sm text-muted-foreground">
        {value ? Number(value).toFixed(2) : "N/A"}
      </td>
    );
  }

  return (
    <td>
      <input
        /* Keyed by the value so a save elsewhere on the row — which refetches
           the sheet — does not leave a stale figure in an uncontrolled box. */
        key={value ?? ""}
        defaultValue={value ? Number(value).toFixed(2) : ""}
        inputMode="decimal"
        placeholder="N/A"
        title="Taka per US dollar for this line. Leave it empty and no dollar figure is shown."
        onBlur={(event) => onSave(event.target.value)}
        className={cn(
          "col-amount h-8 w-full rounded border border-transparent bg-transparent px-2 text-sm outline-none transition",
          "hover:border-border focus-visible:border-primary focus-visible:bg-surface",
        )}
      />
    </td>
  );
}

function Cell({
  value,
  field,
  editable,
  highlight = false,
  onSave,
  onLive,
}: {
  value: string;
  field: string;
  editable: boolean;
  highlight?: boolean;
  onSave: (field: string, value: string) => void;
  /**
   * Fired on every keystroke, so the row's Net Pay can follow along.
   *
   * Separate from `onSave`, which still only fires on blur: saving per
   * keystroke would be one request per digit, and the sheet's whole habit is
   * that a cell commits when you leave it.
   */
  onLive?: (field: string, value: string) => void;
}) {
  if (!editable) {
    return (
      <td>
        <Amount value={value} tone="neutral" className="block" />
      </td>
    );
  }

  return (
    <td>
      <input
        defaultValue={value}
        inputMode="decimal"
        onChange={(event) => onLive?.(field, event.target.value)}
        onBlur={(event) => {
          if (event.target.value !== value) onSave(field, event.target.value);
        }}
        className={cn(
          "col-amount h-8 w-full rounded border border-transparent bg-transparent px-2 text-sm outline-none transition",
          "hover:border-border focus-visible:border-primary focus-visible:bg-surface",
          highlight && "font-medium",
        )}
      />
    </td>
  );
}

/**
 * A part's share of the month's gross, as the heading states it.
 *
 * Derived from the figures rather than read from the rule in Settings, so it
 * reports what this sheet actually does. If somebody edits one person's Basic
 * by hand, the heading stops saying 60% — which is the honest answer and the
 * one worth seeing.
 */
function shareOfGross(part: string | undefined, gross: string): string {
  const whole = Number(gross);
  if (part === undefined || !Number.isFinite(whole) || whole <= 0) return "";
  const percent = (Number(part) / whole) * 100;
  // One place only where it earns it: 60% reads better than 60.0%, and 33.3%
  // has to stay distinguishable from a third of something else.
  const rounded = Math.round(percent * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

/** One money cell in the totals row. */
function FootAmount({ value }: { value: string }) {
  return (
    <td>
      <Amount value={value} tone="neutral" className="block font-semibold" />
    </td>
  );
}

function Figure({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <Card className={cn("p-5", emphasis && "border-primary/40")}>
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <Amount
        value={value}
        tone="neutral"
        className="mt-3 block text-xl font-semibold tracking-tight"
      />
      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </Card>
  );
}

function PayForm({
  open,
  run,
  accounts,
  onClose,
  onPaid,
}: {
  open: boolean;
  run: PayrollRunDto;
  accounts: AccountDto[];
  onClose: () => void;
  onPaid: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    try {
      await payrollApi.pay(run.id, {
        paymentDate: String(data.get("paymentDate")),
        accountId: String(data.get("accountId")),
        paymentMode: String(data.get("paymentMode")) as never,
        paymentMethod: "bank_transfer",
        usdRate: String(data.get("usdRate") ?? "").trim(),
      });
      onPaid();
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not pay.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Pay ${run.label}`}
      description="This is the step that moves money and writes to the ledger."
    >
      <div className="mb-5 rounded-lg border border-border bg-surface-muted p-4">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Leaving the account
        </p>
        <Amount
          value={run.totalNet}
          tone="out"
          className="mt-2 block text-2xl font-semibold"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          The <Amount value={run.totalTds} tone="neutral" /> of tax withheld is
          not part of this — it stays with you until you deposit the challan.
        </p>
      </div>

      <form
        id="pay-run-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
      >
        <Field label="Payment date" required>
          <DateInput
            name="paymentDate"
            required
            defaultValue={todayInDhaka()}
          />
        </Field>
        <Field label="From which account" required>
          <Select name="accountId" required defaultValue={accounts[0]?.id}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </Field>
        {/*
          Every ledger row states its rate — *"puro application a joto dhoroner
          transaction a hok na keno manually prottekbar rate bosate hobe"*. The
          salary rows this drawer writes are ledger rows like any other.
        */}
        <Field
          label="USD rate"
          required
          hint="What one US dollar was worth on the day the salaries left the account"
        >
          <Input
            name="usdRate"
            required
            inputMode="decimal"
            className="col-amount"
            placeholder="122.77"
          />
        </Field>
        <Field
          label="How it appears in the ledger"
          hint="Match how your bank statement shows it, so the register lines up"
        >
          <Select name="paymentMode" defaultValue="consolidated">
            {PAYMENT_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {PAYMENT_MODE_LABELS[mode]}
              </option>
            ))}
          </Select>
        </Field>

        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
          >
            {error}
          </p>
        ) : null}
      </form>

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          form="pay-run-form"
          variant="primary"
          disabled={pending}
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Record the payment
        </Button>
      </div>
    </Drawer>
  );
}

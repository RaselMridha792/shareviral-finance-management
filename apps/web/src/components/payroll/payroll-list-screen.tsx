"use client";

import {
  PAYROLL_STATUS_LABELS,
  isSelectableMonth,
  nearestSelectableMonth,
  recordYears,
  todayInDhaka,
  type Paginated,
} from "@finance/shared";
import { LoaderCircle, Plus, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useEffect, useState, type FormEvent } from "react";

import { useCan } from "@/components/auth/session-provider";
import { DocumentsDialog } from "@/components/ledger/documents-dialog";
import { ReferenceCell } from "@/components/ledger/reference-kind";
import { BulkBar } from "@/components/ui/bulk-bar";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { RowActions, RowActionsHead } from "@/components/ui/row-actions";
import { useBulkSelect } from "@/components/ui/use-bulk-select";
import { useRowDelete } from "@/components/ui/use-row-delete";
import { Amount } from "@/components/money/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { Field, Select, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import {
  SerialCell,
  SerialHead,
  TickCell,
  TickHead,
  TableMessageRow,
  TableScroll,
  Th,
} from "@/components/ui/table";
import { ApiError, trashApi } from "@/lib/api-client";
import { serial } from "@/lib/pagination";
import {
  payrollApi,
  type EligibleMemberDto,
  type PayrollRunDto,
} from "@/lib/payroll";
import { MemberPicker } from "./member-picker";
import { cn, formatDate } from "@/lib/utils";

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

/** SL, Paid on, Month, Gross, Tax withheld, Net paid, Invoice, Reference,
    Status. */
/* Eleven with the tick column, which only a writer sees — the empty-state
   row spans whatever is actually drawn. */
const COLUMNS = 11;

export function PayrollListScreen({
  initialPage,
}: {
  initialPage: Paginated<PayrollRunDto>;
}) {
  const router = useRouter();
  const canWrite = useCan("payroll.write");
  const [documentsFor, setDocumentsFor] = useState<{
    run: PayrollRunDto;
    kinds: readonly string[];
    label: string;
  } | null>(null);
  const [creating, setCreating] = useState(false);

  /**
   * The page on screen, envelope and all.
   *
   * The server hands the first page in; every page after it is fetched here.
   * The page *number* is read off `data.page` rather than kept as a second
   * piece of state, because it arrives with the rows it belongs to — so the
   * pager and the SL column cannot say "page 3" while page 2 is still drawn.
   */
  const [data, setData] = useState(initialPage);
  /*
   * When the server hands a fresh first page — a router.refresh, a
   * revalidated navigation — the table follows it. `useState` reads its prop
   * exactly once, and without this the list kept showing the page as it was
   * when the component first mounted, whatever the server had said since.
   * Render-phase sync, the same pattern the delete dialog uses.
   */
  const [seenInitial, setSeenInitial] = useState(initialPage);
  if (initialPage !== seenInitial) {
    setSeenInitial(initialPage);
    setData(initialPage);
  }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Only the newest request may write. Two quick clicks on Next fire two
   * fetches, and without this the slower answer lands last — leaving the rows
   * of one page under the number of another.
   */
  const request = useRef(0);

  async function goToPage(next: number) {
    const token = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const result = await payrollApi.listRuns(next);
      if (token === request.current) setData(result);
    } catch (caught) {
      if (token === request.current) {
        setError(
          caught instanceof ApiError
            ? caught.message
            : "Could not load that page.",
        );
      }
    } finally {
      if (token === request.current) setLoading(false);
    }
  }

  /*
   * Ticking, on the owner's word — *"etao tick dewar option rakho"*.
   *
   * This table was left out of #4 deliberately, and the reason is worth
   * keeping in view rather than deleting with the exclusion: a payroll run is
   * not an expense row. A PAID run has ledger entries behind it and money that
   * has left the bank, and the server refuses to trash one — `blockedWhen` on
   * the registry's `payroll-run` entry. So the tick offers exactly what the
   * single-row Delete offers, which is the rule: a run the server will not
   * delete is refused here too, by name, and nothing in the selection moves.
   */
  const bulk = useBulkSelect(data?.items ?? []);
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkAsking, setBulkAsking] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const del = useRowDelete<PayrollRunDto>({
    kind: "payroll-run",
    subject: "payroll run",
    describe: (run) => (
      <div className="flex flex-col">
        <span className="font-medium">{run.label}</span>
        <span className="text-xs text-muted-foreground">
          {run.status} · net {run.totalNet}
        </span>
      </div>
    ),
    consequences: (
      <p>
        The sheet and every payslip in it go with the run, and can be put back
        from{" "}
        <span className="font-medium text-foreground">
          Settings &rarr; Trashed
        </span>
        . One thing deleting does <em>not</em> touch: if this run was paid, the
        payment entries it posted{" "}
        <span className="font-medium text-foreground">
          stay on All transactions
        </span>{" "}
        — void or delete those there too, or the money still reads as spent.
      </p>
    ),
    /*
     * Re-fetch the page the reader is on, not `router.refresh()`.
     *
     * The rows live in `useState(initialPage)`, which reads its prop exactly
     * once — a refresh hands this component a new prop it never looks at, so
     * a deleted run sat in the table until a hard reload, answering every
     * further attempt with "already deleted". The state has to be written by
     * the same hand that writes it for the pager.
     */
    /*
     * The page to land on after the row is gone. Deleting the only row of
     * page two would refetch an empty page two — and the pager, which
     * rightly draws nothing for one page, would leave no way back. Stepping
     * back one page when the last row of a later page goes is the behaviour
     * every mail client settled on.
     */
    onDone: () =>
      void goToPage(
        data.items.length === 1 && data.page > 1 ? data.page - 1 : data.page,
      ),
  });

  return (
    <>
      <PageHeader
        title="Payroll"
        icon="payments"
        description="One run a month. Nothing leaves the bank until you say so."
        actions={
          canWrite ? (
            <Button
              variant="primary"
              size="md"
              onClick={() => setCreating(true)}
            >
              <Plus className="size-4" />
              New month
            </Button>
          ) : null
        }
      />

      {/*
        `total`, not `items.length`: with twenty rows to a page an empty *page*
        is not an empty company. Past page one this branch would otherwise
        announce "No payroll runs yet" over a set of runs that exist.
      */}
      {data.total === 0 ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex size-[52px] items-center justify-center rounded-full bg-primary/15 text-primary-text">
            <Wallet className="size-6" />
          </span>
          <div>
            <p className="text-lg font-semibold">No payroll runs yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Start a month, build the salary sheet, type in each person&apos;s
              tax, then mark it paid — that last step is what moves money.
            </p>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/*
            Above the table rather than inside it: a page that failed to load
            leaves the previous page's rows on screen, and those rows are still
            true. Replacing them with the error would throw away good data to
            report a bad fetch.
          */}
          {error ? (
            <p
              role="alert"
              className="border-b border-negative/20 bg-negative/10 px-4 py-2.5 text-sm text-negative"
            >
              {error}
            </p>
          ) : null}
          {/*
            OUTSIDE the table, which is the whole fix.

            It used to sit between `<table>` and `<thead>`. Nothing but
            `<caption>`, `<colgroup>`, a row group or a script may live there,
            so the browser hoisted the div out of the table during parsing and
            left it floating over the header — the owner's screenshot: a box
            sitting on top of the first rows, the header pushed out of line.
            *"multiple select korar por eta table er vitore dhuke jacche and
            broken hoye jacche. team page er ta thik ache eirokom howa ucit."*

            Team's has always been outside its table and has always looked
            right; this is the same placement, above the scroller so the bar
            spans the card whatever the table's width is and does not scroll
            sideways away from the ticks it belongs to.
          */}
          <BulkBar
            count={bulk.count}
            noun="payroll run"
            pending={bulkPending}
            onClear={bulk.clear}
            onTrash={() => {
              setBulkError(null);
              setBulkAsking(true);
            }}
          />
          <TableScroll>
            <table
              aria-busy={loading}
              className={cn(
                "table-data min-w-[820px] text-sm",
                // Dimmed while the next page is in flight — "being replaced",
                // without the table dropping to a spinner and springing back.
                loading && "opacity-60",
              )}
            >
              <thead>
                <tr className="text-left">
                  {canWrite ? (
                    <TickHead
                      state={bulk.headerState}
                      onChange={bulk.allOnPage}
                    />
                  ) : null}
                  <SerialHead />
                  <Th width="w-28">Paid on</Th>
                  <Th width="w-40">Month</Th>
                  <Th width="w-32" align="right">
                    Gross
                  </Th>
                  <Th width="w-32" align="right">
                    Tax withheld
                  </Th>
                  <Th width="w-32" align="right">
                    Net paid
                  </Th>
                  {/* The month's own paperwork, the same pair every other
                      money table on this site carries. A run has no typed
                      number on either side — nobody issues us a salary
                      invoice — so these cells are an eye or they are N/A. */}
                  <Th width="w-24">Invoice</Th>
                  <Th width="w-24">Reference</Th>
                  <Th width="w-28">Status</Th>
                  <RowActionsHead deletable={canWrite} />
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 ? (
                  <TableMessageRow colSpan={COLUMNS}>
                    No runs on this page.
                  </TableMessageRow>
                ) : (
                  data.items.map((run, index) => (
                    <tr key={run.id} className="row-finance">
                      {/*
                        Counted across pages. `index + 1` restarted at 1 on page
                        two, so the twenty-first run and the first one both
                        answered to "1".
                      */}
                      {canWrite ? (
                        <TickCell
                          checked={bulk.isTicked(run.id)}
                          onChange={() => bulk.toggle(run.id)}
                          label={run.label}
                        />
                      ) : null}
                      <SerialCell n={serial(data.page, index)} />
                      <td className="num text-muted-foreground">
                        {/* Day/month/year, like everywhere else. This one
                            escaped both sweeps: no run on the development
                            database has been paid, so the column reads N/A
                            here and the browser check had nothing to see. It is
                            the source check that catches it now. */}
                        {run.paymentDate ? formatDate(run.paymentDate) : "N/A"}
                      </td>
                      <td>
                        {/* One link per row — see the note in team-screen.tsx. */}
                        <Link
                          href={`/payroll/${run.id}`}
                          prefetch={false}
                          className="font-medium text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
                        >
                          {run.label}
                        </Link>
                      </td>
                      <td className="text-right">
                        <Amount
                          value={run.totalGross}
                          tone="neutral"
                          className="block"
                        />
                      </td>
                      <td className="text-right">
                        <Amount
                          value={run.totalTds}
                          tone="neutral"
                          className="block"
                        />
                      </td>
                      <td className="text-right">
                        <Amount
                          value={run.totalNet}
                          tone="neutral"
                          className="block font-medium"
                        />
                      </td>
                      {/*
                        Counted per kind, never on the row's total. A run with
                        only an invoice attached would otherwise offer an eye
                        on Reference as well, and a click into an empty drawer
                        is the complaint this pattern exists to answer.
                      */}
                      <ReferenceCell
                        value={null}
                        documentCount={run.invoiceCount}
                        onOpen={() =>
                          setDocumentsFor({
                            run,
                            kinds: ["invoice"],
                            label: "invoice",
                          })
                        }
                      />
                      <ReferenceCell
                        value={null}
                        documentCount={run.recordCount}
                        onOpen={() =>
                          setDocumentsFor({
                            run,
                            kinds: ["bank_statement", "receipt", "other"],
                            label: "payment",
                          })
                        }
                      />
                      <td>
                        <Badge
                          tone={
                            run.status === "paid"
                              ? "positive"
                              : run.status === "finalized"
                                ? "primary"
                                : "neutral"
                          }
                        >
                          {PAYROLL_STATUS_LABELS[run.status]}
                        </Badge>
                      </td>
                      <RowActions
                        onEdit={() => router.push(`/payroll/${run.id}`)}
                        second="status"
                        // The status of a run is changed on the sheet itself,
                        // where the figures being finalised are in front of
                        // whoever is finalising them.
                        onSecond={() => router.push(`/payroll/${run.id}`)}
                        onDelete={canWrite ? () => del.ask(run) : undefined}
                      />
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}

      {/*
        A sibling of the card, never inside the branch above. A pager written
        into the empty case disappears on an empty page, which is precisely the
        page somebody needs it on to get back. It draws nothing at one page.
      */}
      <Pagination
        page={data.page}
        totalPages={data.totalPages}
        total={data.total}
        noun="run"
        onPage={goToPage}
      />

      <NewRunForm
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => router.push(`/payroll/${id}`)}
      />
      {del.dialog}

      {/*
        The ticked runs, together — and all-or-nothing, which matters more here
        than anywhere.

        A PAID run has ledger entries behind it and money that has left the
        bank; the server refuses to trash one. So a selection holding a paid run
        is refused whole, naming it, and not one of the others moves either.
        Deleting "the ones it could" would leave somebody looking at a half-done
        act with no way to tell which half.
      */}
      {/*
        The run's own documents, opened from the eye that knows it has
        something to show. `transactionId` is the prop's name and the run's id
        is what it carries — the dialog reads four kinds of owner now, and the
        name is older than three of them.
      */}
      {documentsFor ? (
        <DocumentsDialog
          transactionId={documentsFor.run.id}
          owner="payroll_run"
          refNo={documentsFor.run.label}
          kinds={documentsFor.kinds}
          title={`${documentsFor.label === "invoice" ? "Invoice" : "Reference"} — ${documentsFor.run.label}`}
          onClose={() => setDocumentsFor(null)}
        />
      ) : null}

      <DeleteDialog
        open={bulkAsking}
        subject="payroll run"
        count={bulk.count}
        summary={
          <>
            {bulk.selected
              .slice(0, 5)
              .map((run) => run.label)
              .join(", ")}
            {bulk.count > 5 ? ` and ${bulk.count - 5} more` : ""}
          </>
        }
        consequences={
          <p>
            The sheets leave this list and the trash can put them back. A run
            that has been <span className="font-medium text-foreground">paid</span>{" "}
            cannot go at all — its entries are on the ledger — and if one is in
            the selection the whole request is refused rather than half done.
          </p>
        }
        pending={bulkPending}
        error={bulkError}
        onCancel={() => setBulkAsking(false)}
        onConfirm={(reason) => {
          setBulkPending(true);
          setBulkError(null);
          void trashApi
            .removeMany(
              "payroll-run",
              bulk.selected.map((run) => run.id),
              reason,
            )
            .then(() => {
              setBulkAsking(false);
              bulk.clear();
              /* The same page the single delete returns to — and back one
                 when the page just emptied, so a bulk delete does not leave the
                 reader on a blank page 3. */
              void goToPage(
                bulk.count >= data.items.length && data.page > 1
                  ? data.page - 1
                  : data.page,
              );
            })
            .catch((err: unknown) =>
              setBulkError(
                err instanceof ApiError ? err.message : "That did not work.",
              ),
            )
            .finally(() => setBulkPending(false));
        }}
      />
    </>
  );
}

function NewRunForm({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const today = todayInDhaka();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));

  /**
   * Controlled, so the month list can grey out what the chosen year cannot
   * have.
   *
   * These were uncontrolled `defaultValue` selects, which meant the two boxes
   * could not see each other: picking a year could not tell the month list that
   * half its options had just become impossible. This is the picker that
   * *writes* — an accidental payroll run for a month that has not happened
   * creates a period, generates lines from today's salaries, and has to be
   * unpicked by hand.
   */
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);

  /*
   * Who the month could pay, fetched the moment the drawer opens and again
   * whenever the month moves. Everyone with a recorded pay starts ticked —
   * the owner's rule is choose-who-not-to-pay, and a list that opens empty
   * would make the common case twenty clicks.
   */
  const [eligible, setEligible] = useState<EligibleMemberDto[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    let stale = false;
    // Reading on open is what an effect is for; the null puts the loading
    // line up while the month's list is fetched. The same exemption every
    // read-on-open panel takes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEligible(null);
    payrollApi
      .eligible(year, month)
      .then((people) => {
        if (stale) return;
        setEligible(people);
        setChosen(
          new Set(
            people.filter((p) => p.monthlyGross !== null).map((p) => p.id),
          ),
        );
      })
      .catch(() => {
        if (!stale) setEligible([]);
      });
    return () => {
      stale = true;
    };
  }, [open, year, month]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    try {
      const run = await payrollApi.createRun({
        periodYear: year,
        periodMonth: month,
        notes: String(data.get("notes") ?? "") || undefined,
      });
      /*
       * The sheet is built here, for the ticked people, before anybody sees
       * it — the extra "Build" click the owner asked to lose. If this half
       * fails the run still exists as an empty draft, and the sheet's own
       * People button offers the same list again.
       */
      await payrollApi.syncMembers(run.id, [...chosen]).catch(() => undefined);
      onCreated(run.id);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not start that run.",
      );
      setPending(false);
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title="Start a payroll month">
      <form id="run-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Month" required>
            <Select
              value={month}
              onChange={(event) => setMonth(Number(event.target.value))}
            >
              {MONTHS.map((name, index) => (
                <option
                  key={name}
                  value={index + 1}
                  disabled={!isSelectableMonth(year, index + 1)}
                >
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Year" required>
            {/*
              2026 onwards, growing on its own. It used to offer next year as
              well — a payroll month that has not happened, generated from
              today's salaries and frozen against a period nobody has worked.
            */}
            <Select
              value={year}
              onChange={(event) => {
                const next = Number(event.target.value);
                setYear(next);
                // Changing the year can strand the month: December in a past
                // year is fine, December in this one is not yet.
                setMonth((current) => nearestSelectableMonth(next, current));
              }}
            >
              {recordYears().map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {/*
          The owner's flow: choose who is on the month while starting it, and
          keep choosing for as long as it stays a draft. The sheet's People
          button reopens this same list later.
        */}
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

        <Field label="Notes">
          <Textarea name="notes" />
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
          form="run-form"
          variant="primary"
          disabled={pending}
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Start
        </Button>
      </div>
    </Drawer>
  );
}

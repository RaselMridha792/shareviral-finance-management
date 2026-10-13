# Brief — TDS refunded to staff: what is owed to the government drops by what was handed back

**For:** two Claude sessions, one after the other. **Piece T1 is a schema change and travels
alone.**
**From:** the planning session, 13 Oct 2026. The owner said yes the same day: *"hea korbo kore
felo"*.

## Why

The boss's sheet is now on live (SESSIONS #160): May to August 2026. Its TDS went like this:
- **May:** salaries were paid **gross**, and TDS was not taken. The May PAYROLL tab still lists
  ৳13,720 of TDS, and its note says so.
- **June:** the salaries took June's TDS (৳21,701) and also May's, as the "TDS (May)" column.
- **July:** *"TDS deducted for May and June has been refunded to team members"*. That is ৳35,421,
  imported as an "Other expenses" row, "TDS Repaid", paid from Standard Chartered.
- **July and August:** TDS of ৳21,916 and ৳23,840 was withheld and is still held.

The app works out what is owed (`tds.service.ts`, `outstandingAllTime` and the month view) as
**payroll TDS + vendor tax withheld − challans deposited**. It has no idea of tax handed back to
the people it was taken from. So it says **৳81,177 is owed** to the government. The truth is
**৳45,756** (July + August).

A tax figure that is ৳35,421 too high is the figure somebody files.

## The decision

**A refund to staff is its own record.** It is not a challan. A challan is money paid to the
government, and it goes into the TDS return. A refund is not, and must never reach a return or
the challan list.

- **What is owed** = withheld − deposited − **refunded**, both for each month and for all time.
- **Payslips do not change.** The June lines still show the TDS they took. The refund is a
  separate event.
- **Each refund row** names:
  - **the month whose TDS it hands back**: `period_year` and `period_month`;
  - the amount;
  - the day it was handed back;
  - optionally, the ledger row that paid it out. Here that is the July "TDS Repaid" row.

## Piece T1 — schema, alone

Add `deploy/sql/2026-10-13-tds-refunds.sql`, idempotent, with a new table `tds_refunds`:
- `id`;
- `period_year int` and `period_month int`, with a 1–12 check;
- `amount numeric(14,2)`, checked `> 0`;
- `refunded_on date`;
- `transaction_id uuid` (nullable), referencing `transactions`, on delete set null;
- `note text`;
- `created_by` and `updated_by`, referencing `users`, on delete set null;
- timestamps;
- the soft-delete columns, if the app's other money tables have them.

Update the Drizzle schema in the same commit, and add nothing that reads it. Run `node .sql.mjs`
locally, and push it alone.

## Piece T2 — the TDS page and every reader of "owed"

- **The service.**
  - `tds.service.ts` subtracts refunds in `outstandingAllTime` and in the month view.
  - The month view gains a **Refunded to staff** column.
- **Every other reader of the owed figure** subtracts them too. Find them all, do not guess:
  - the Dashboard's tax figure;
  - the Statement's "owed to the treasury" line;
  - the Assistant's look-ups;
  - anything else.

  List each one in the handover. The shared-code rule applies.
- **The TDS page** gets **Record a refund to staff**: month, amount, date, the ledger row
  (optional), and a note.
  - Who can use it: `tds.write`, meaning Super Admin and CFO.
  - Rows can be edited and deleted, and every change is audited.
- **Never in the challan list or the export for a return.**

**Measure it** with a harness:
- refunds of 13,720 for May and 21,701 for June take the owed figure from 81,177 to 45,756,
  everywhere it shows;
- the challan list and the return export are unchanged;
- payslips are unchanged;
- a reader cannot record a refund (403).

## The data, after T2 is live

The owner enters two rows on the TDS page, live and local:
- **May 2026:** ৳13,720, refunded on the July "TDS Repaid" date (31 Jul 2026), linked to that
  row;
- **June 2026:** ৳21,701, the same day and the same link.

The TDS page should then read ৳45,756 owed: July 21,916 + August 23,840.

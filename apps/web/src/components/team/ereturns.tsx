"use client";

import {
  fiscalYearLabelLong,
  fiscalYearOf,
  todayInDhaka,
} from "@finance/shared";
import { LoaderCircle, Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { DateInput, Field, Input, Select } from "@/components/ui/field";
import { SerialCell, SerialHead, TableScroll, Th } from "@/components/ui/table";
import { ApiError } from "@/lib/api-client";
import { formatDate } from "@/lib/utils";
import { teamApi, type EreturnDto } from "@/lib/payroll";

/**
 * One income-tax e-Return per fiscal year.
 *
 * The owner: *"E Return (akhane akta kore ortho bochor thakbe like 2026-2027
 * and document upload korar option thakbe. Ata every year a 1 ta hobe)"*.
 *
 * The year is the fact and the acknowledgement is a document about it. One per
 * year is enforced by a partial unique index rather than by this screen, so two
 * people recording the same year from two tabs get one row and not two.
 *
 * The e-TIN itself is not here — it is a field on the person, already on the
 * profile above and in the edit form.
 */
export function Ereturns({
  memberId,
  memberName,
  ereturns,
  canWrite,
  onSaved,
}: {
  memberId: string;
  memberName: string;
  ereturns: EreturnDto[];
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <Card>
      <CardHeader
        title="E-Return"
        description="One filing per income year, with its acknowledgement"
        action={
          canWrite ? (
            <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" />
              Record a year
            </Button>
          ) : null
        }
      />
      <CardBody className="p-0">
        {ereturns.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            No return recorded yet.
          </p>
        ) : (
          <TableScroll>
            <table className="table-data min-w-[640px] text-sm">
              <thead>
                <tr className="text-left">
                  <SerialHead />
                  <Th width="w-32">Income year</Th>
                  <Th width="w-32">Submitted</Th>
                  <Th>Acknowledgement</Th>
                  <Th>Notes</Th>
                </tr>
              </thead>
              <tbody>
                {ereturns.map((one, index) => (
                  <tr key={one.id} className="row-finance">
                    <SerialCell n={index + 1} />
                    <td className="num">{fiscalYearLabelLong(one.fiscalYear)}</td>
                    <td className="num text-muted-foreground">
                      {one.submittedOn ? formatDate(one.submittedOn) : "N/A"}
                    </td>
                    <td>
                      {one.fileName ? (
                        <span className="text-xs">{one.fileName}</span>
                      ) : (
                        /* Said out loud rather than left blank: a year recorded
                           with no acknowledgement is the one somebody has to go
                           back and finish. */
                        <span className="text-xs text-muted-foreground">
                          Nothing attached
                        </span>
                      )}
                    </td>
                    <td className="cell-prose text-muted-foreground">
                      {one.notes ?? "N/A"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </CardBody>

      {/*
        No uploader here.

        The acknowledgement is a `team_member` file of kind `e_return`, so it
        already has a row on the person's **Documents** card above — which is
        where somebody looks for a person's papers, and where every other
        certificate of theirs lives. A second upload control on this card would
        be a second place for the same file, and the two would disagree the
        first time one of them was used.

        Why a team_member file at all: `files_one_owner` counts eight owner
        columns and three migrations have already fought over that constraint. A
        ninth would mean a fourth.
      */}

      {adding ? (
        <EreturnForm
          memberId={memberId}
          memberName={memberName}
          taken={ereturns.map((one) => one.fiscalYear)}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            onSaved();
          }}
        />
      ) : null}
    </Card>
  );
}

function EreturnForm({
  memberId,
  memberName,
  taken,
  onClose,
  onSaved,
}: {
  memberId: string;
  memberName: string;
  /** Years already on the list — recording one twice is the same act twice. */
  taken: number[];
  onClose: () => void;
  onSaved: () => void;
}) {
  /*
   * Backwards only, from the year now running.
   *
   * A return for a year that has not finished cannot have been filed, and
   * offering it is how one gets recorded against the wrong label. The list is
   * built from `fiscalYearOf`, which knows Bangladesh's year runs July to June
   * — so on 1 September 2026 the year now running is 2026-2027.
   */
  const current = fiscalYearOf(todayInDhaka(), "bd_july_june");
  const years = Array.from({ length: 8 }, (_, i) => current - i);
  const free = years.filter((y) => !taken.includes(y));

  const [fiscalYear, setFiscalYear] = useState(String(free[0] ?? current));
  const [submittedOn, setSubmittedOn] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setError(null);
    try {
      await teamApi.upsertEreturn(memberId, {
        fiscalYear: Number(fiscalYear),
        submittedOn: submittedOn || null,
        notes: notes.trim() || undefined,
      });
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "That did not save.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${memberName} — record an e-Return`}
      description="The income year it was filed for. Attach the acknowledgement on the card afterwards."
    >
      <div className="flex flex-col gap-4">
        <Field label="Income year" required>
          <Select
            value={fiscalYear}
            onChange={(event) => setFiscalYear(event.target.value)}
          >
            {years.map((year) => (
              <option key={year} value={year} disabled={taken.includes(year)}>
                {fiscalYearLabelLong(year)}
                {taken.includes(year) ? " — already recorded" : ""}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Submitted on"
          hint="Blank is fine — the year is the fact, the date is a detail"
        >
          <DateInput
            value={submittedOn}
            onChange={(event) => setSubmittedOn(event.target.value)}
          />
        </Field>

        <Field label="Notes" hint="Anything worth remembering about this filing">
          <Input
            value={notes}
            maxLength={300}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>

        {error ? <p className="text-sm text-negative">{error}</p> : null}
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={pending}
          onClick={() => void save()}
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Record it
        </Button>
      </div>
    </Drawer>
  );
}

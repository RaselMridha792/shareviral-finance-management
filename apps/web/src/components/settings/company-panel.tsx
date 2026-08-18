"use client";

import { formatMoney, type NumberFormat } from "@finance/shared";
import { LoaderCircle, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { useCan } from "@/components/auth/session-provider";
import type { AppSettingsDto } from "@/components/settings-provider";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ApiError } from "@/lib/api-client";
import { settingsApi } from "@/lib/masters";
import { PeriodLock } from "./period-lock";

export function CompanyPanel({ settings }: { settings: AppSettingsDto }) {
  const router = useRouter();
  const canWrite = useCan("settings.write");

  const [format, setFormat] = useState<NumberFormat>(settings.numberFormat);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    try {
      await settingsApi.update({
        companyName: String(data.get("companyName") ?? ""),
        companyEtin: String(data.get("companyEtin") ?? ""),
        companyBin: String(data.get("companyBin") ?? ""),
        companyAddress: String(data.get("companyAddress") ?? ""),
        companyTagline: String(data.get("companyTagline") ?? ""),
        companyLegalNote: String(data.get("companyLegalNote") ?? ""),
        companyWebsite: String(data.get("companyWebsite") ?? ""),
        companyEmail: String(data.get("companyEmail") ?? ""),
        payslipSignatoryName: String(data.get("payslipSignatoryName") ?? ""),
        payslipSignatoryTitle: String(data.get("payslipSignatoryTitle") ?? ""),
        fiscalYearMode: String(data.get("fiscalYearMode") ?? "") as
          "bd_july_june" | "calendar",
        numberFormat: String(data.get("numberFormat") ?? "") as NumberFormat,
        tdsReminderDays: Number(data.get("tdsReminderDays") ?? 7),
      });
      setSaved(true);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors ?? {});
      } else {
        setError("Could not save.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Card>
          <CardHeader
            title="Company"
            description="Shown on payslips and Excel exports"
          />
          <CardBody className="flex flex-col gap-4">
            <Field label="Name" required error={fieldErrors.companyName}>
              <Input
                name="companyName"
                defaultValue={settings.companyName}
                disabled={!canWrite}
                required
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="e-TIN"
                error={fieldErrors.companyEtin}
                hint="12 digits"
              >
                <Input
                  name="companyEtin"
                  className="num"
                  inputMode="numeric"
                  maxLength={12}
                  defaultValue={settings.companyEtin ?? ""}
                  disabled={!canWrite}
                />
              </Field>
              <Field
                label="BIN"
                error={fieldErrors.companyBin}
                hint="13 digits"
              >
                <Input
                  name="companyBin"
                  className="num"
                  inputMode="numeric"
                  maxLength={13}
                  defaultValue={settings.companyBin ?? ""}
                  disabled={!canWrite}
                />
              </Field>
            </div>

            <Field label="Address" error={fieldErrors.companyAddress}>
              <Textarea
                name="companyAddress"
                defaultValue={settings.companyAddress ?? ""}
                disabled={!canWrite}
              />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Payslip letterhead"
            description="What prints across the top and bottom of a payslip"
          />
          <CardBody className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Tagline"
                error={fieldErrors.companyTagline}
                hint="Under the company mark, in capitals"
              >
                <Input
                  name="companyTagline"
                  maxLength={120}
                  placeholder="Connect fans. Empower brands."
                  defaultValue={settings.companyTagline ?? ""}
                  disabled={!canWrite}
                />
              </Field>

              <Field
                label="Legal note"
                error={fieldErrors.companyLegalNote}
                hint="Beside the company name, on the line under the band"
              >
                <Input
                  name="companyLegalNote"
                  maxLength={200}
                  placeholder="Technical branch of ..."
                  defaultValue={settings.companyLegalNote ?? ""}
                  disabled={!canWrite}
                />
              </Field>

              <Field label="Website" error={fieldErrors.companyWebsite}>
                <Input
                  name="companyWebsite"
                  maxLength={120}
                  placeholder="example.com"
                  defaultValue={settings.companyWebsite ?? ""}
                  disabled={!canWrite}
                />
              </Field>

              <Field
                label="Accounts email"
                error={fieldErrors.companyEmail}
                hint="Where an employee writes about a mistake on their slip"
              >
                <Input
                  name="companyEmail"
                  type="email"
                  maxLength={160}
                  placeholder="accounts@example.com"
                  defaultValue={settings.companyEmail ?? ""}
                  disabled={!canWrite}
                />
              </Field>

              <Field
                label="Signatory"
                error={fieldErrors.payslipSignatoryName}
                hint="Signs every payslip"
              >
                <Input
                  name="payslipSignatoryName"
                  maxLength={120}
                  defaultValue={settings.payslipSignatoryName ?? ""}
                  disabled={!canWrite}
                />
              </Field>

              <Field
                label="Signatory's title"
                error={fieldErrors.payslipSignatoryTitle}
              >
                <Input
                  name="payslipSignatoryTitle"
                  maxLength={120}
                  defaultValue={settings.payslipSignatoryTitle ?? ""}
                  disabled={!canWrite}
                />
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Financial year and figures"
            description="Decides which months a quarter covers, and how amounts read"
          />
          <CardBody className="flex flex-col gap-4">
            <Field
              label="Financial year"
              hint="Bangladesh's income year runs 1 July – 30 June"
            >
              <Select
                name="fiscalYearMode"
                defaultValue={settings.fiscalYearMode}
                disabled={!canWrite}
              >
                <option value="bd_july_june">
                  July – June (Bangladesh income year)
                </option>
                <option value="calendar">January – December</option>
              </Select>
            </Field>

            <Field label="Number format">
              <Select
                name="numberFormat"
                value={format}
                onChange={(event) =>
                  setFormat(event.target.value as NumberFormat)
                }
                disabled={!canWrite}
              >
                <option value="bangladeshi">
                  Bangladeshi — lakh and crore
                </option>
                <option value="western">Western — thousands</option>
              </Select>
            </Field>

            {/* Show the actual effect rather than describing it. */}
            <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg bg-surface-muted px-4 py-3">
              {["4500", "125000", "1250000", "25000000"].map((value) => (
                <span key={value} className="col-amount text-sm">
                  {formatMoney(value, { format, hideDecimals: true })}
                </span>
              ))}
            </div>

            <Field
              label="Deadline warning"
              error={fieldErrors.tdsReminderDays}
              hint="Days before a filing date it appears on the dashboard"
            >
              <Input
                name="tdsReminderDays"
                type="number"
                min={1}
                max={60}
                className="num max-w-28"
                defaultValue={settings.tdsReminderDays}
                disabled={!canWrite}
              />
            </Field>
          </CardBody>
        </Card>

        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
          >
            {error}
          </p>
        ) : null}

        {canWrite ? (
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : null}
              Save changes
            </Button>
            {saved ? (
              <span className="text-sm text-positive">Saved</span>
            ) : null}
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Lock className="size-4" />
            Only a Super Admin can change these.
          </p>
        )}
      </form>

      <PeriodLock lockedThrough={settings.booksLockedThrough} />
    </>
  );
}

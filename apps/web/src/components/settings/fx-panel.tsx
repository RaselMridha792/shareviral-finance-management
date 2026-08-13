"use client";

import { FX_REPORT_BASES, FX_REPORT_BASIS_LABELS } from "@finance/shared";
import { CircleAlert, LoaderCircle, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { useCan } from "@/components/auth/session-provider";
import type { AppSettingsDto } from "@/components/settings-provider";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ApiError } from "@/lib/api-client";
import { settingsApi } from "@/lib/masters";

export function FxPanel({ settings }: { settings: AppSettingsDto }) {
  const router = useRouter();
  const canWrite = useCan("settings.write");

  const [mode, setMode] = useState(settings.fxMode);
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
        fxMode: mode,
        fxFixedUsdBdt: String(data.get("fxFixedUsdBdt") ?? ""),
        fxProvider: String(data.get("fxProvider") ?? ""),
        fxReportBasis: String(
          data.get("fxReportBasis") ?? "",
        ) as (typeof FX_REPORT_BASES)[number],
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
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="USD to BDT"
          description="Used when the CEO views reports in dollars"
        />
        <CardBody className="flex flex-col gap-4">
          <Field label="Where the rate comes from">
            <Select
              name="fxMode"
              value={mode}
              onChange={(event) => setMode(event.target.value as typeof mode)}
              disabled={!canWrite}
            >
              <option value="fixed">A rate I set myself</option>
              <option value="live">Fetched from the internet</option>
            </Select>
          </Field>

          <Field
            label="Fixed rate"
            error={fieldErrors.fxFixedUsdBdt}
            hint={
              mode === "fixed"
                ? "1 USD = this many BDT"
                : "Kept as the fallback if the live rate can't be fetched"
            }
          >
            <Input
              name="fxFixedUsdBdt"
              className="num max-w-40"
              inputMode="decimal"
              placeholder="118.40"
              defaultValue={settings.fxFixedUsdBdt ?? ""}
              disabled={!canWrite}
            />
          </Field>

          {mode === "live" ? (
            <Field
              label="Provider"
              error={fieldErrors.fxProvider}
              hint={
                settings.fxLastSyncedAt
                  ? `Last fetched ${new Date(settings.fxLastSyncedAt).toLocaleString()}`
                  : "Not fetched yet — the fetcher arrives in Phase 7"
              }
            >
              <Input
                name="fxProvider"
                defaultValue={settings.fxProvider ?? ""}
                disabled={!canWrite}
              />
            </Field>
          ) : null}

          <Field
            label="Which rate reports use"
            hint="Applies to translated report figures, never to money actually converted"
          >
            <Select
              name="fxReportBasis"
              defaultValue={settings.fxReportBasis}
              disabled={!canWrite}
            >
              {FX_REPORT_BASES.map((basis) => (
                <option key={basis} value={basis}>
                  {FX_REPORT_BASIS_LABELS[basis]}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex items-start gap-3 rounded-lg bg-warning/10 px-4 py-3">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            <p className="text-sm text-muted-foreground">
              A USD report figure is a translation, not a fact. Two months
              converted at different rates appear to change even when nothing
              did. Money that was genuinely converted — the CEO&apos;s
              remittances — keeps the rate the bank actually gave, forever, and
              is never re-translated.
            </p>
          </div>
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
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
            Save changes
          </Button>
          {saved ? <span className="text-sm text-positive">Saved</span> : null}
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Lock className="size-4" />
          Only a Super Admin can change these.
        </p>
      )}
    </form>
  );
}

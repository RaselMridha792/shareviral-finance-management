"use client";

import { todayInDhaka } from "@finance/shared";
import { Lock, LockOpen, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DateInput, Field } from "@/components/ui/field";
import { ApiError } from "@/lib/api-client";
import { settingsApi } from "@/lib/masters";

/**
 * Closing the books up to a date.
 *
 * There is no approval workflow in this app, so nothing otherwise stops someone
 * editing June after the CEO has read June. The audit trail records it, but
 * recording is not preventing. This is the preventing part, and it is one date.
 */
export function PeriodLock({ lockedThrough }: { lockedThrough: string | null }) {
  const router = useRouter();
  const canWrite = useCan("settings.write");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState(lockedThrough ?? "");

  async function save(next: string | null) {
    setPending(true);
    setError(null);
    try {
      await settingsApi.lockBooks({ booksLockedThrough: next });
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not change the lock.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Closing the books"
        description="Nothing dated on or before this can be added, edited or voided."
      />
      <CardBody className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-lg bg-surface-muted px-4 py-3">
          {lockedThrough ? (
            <Lock className="mt-0.5 size-4 shrink-0 text-positive" />
          ) : (
            <LockOpen className="mt-0.5 size-4 shrink-0 text-warning" />
          )}
          <p className="text-sm">
            {lockedThrough ? (
              <>
                Closed through <span className="num">{lockedThrough}</span>.
                Anything on or before that date is read-only for everyone,
                including a Super Admin.
              </>
            ) : (
              <>
                The books are open. Any month can still be changed after it has
                been reported — the trail will show who did it, but nothing will
                stop them.
              </>
            )}
          </p>
        </div>

        {canWrite ? (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Close everything up to and including" className="w-56">
                <DateInput
                  value={value}
                  max={todayInDhaka()}
                  onChange={(event) => setValue(event.target.value)}
                />
              </Field>
              <Button
                variant="primary"
                disabled={pending || !value || value === lockedThrough}
                onClick={() => void save(value)}
              >
                {pending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Lock className="size-4" />
                )}
                Close the books
              </Button>
              {lockedThrough ? (
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() => {
                    setValue("");
                    void save(null);
                  }}
                >
                  <LockOpen className="size-4" />
                  Reopen
                </Button>
              ) : null}
            </div>

            <p className="text-xs text-muted-foreground">
              Close a month once its figures have been reported and agreed.
              Reopening is a Super Admin decision and is itself recorded.
            </p>
          </>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Lock className="size-4" />
            Only a Super Admin can close or reopen the books.
          </p>
        )}

        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
          >
            {error}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

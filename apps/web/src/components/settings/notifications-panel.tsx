"use client";

import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import {
  ApiError,
  notificationsApi,
  type NotificationSwitches,
} from "@/lib/api-client";

/**
 * Settings → Notifications.
 *
 * Four switches and a button, and the page's whole job is making the fourth
 * switch read differently from the first three. Three of these are a date
 * arriving — a renewal, a deadline, a month that ended — and a person either
 * wants to be told or does not. The fourth watches what colleagues do, which is
 * a different kind of decision, so it sits apart and says who it tells.
 */

const EVENTS: {
  key: keyof NotificationSwitches;
  label: string;
  detail: string;
}[] = [
  {
    key: "renewals",
    label: "A plan renews in three days",
    detail:
      "Three days is enough to cancel it, change it, or make sure the card has room. The same trigger sends the email, and switching one off leaves the other running.",
  },
  {
    key: "tdsDeadline",
    label: "The TDS deposit deadline is near",
    detail:
      "Only when something is still undeposited. Two weeks after month end, and tighter in June — the 29th and 30th are same-day.",
  },
  {
    key: "payrollUnpaid",
    label: "A month ended and its payroll is not paid",
    detail: "Raised once for that month, not once a day until it is.",
  },
];

export function NotificationsPanel() {
  const canWrite = useCan("settings.write");
  const toast = useToast();

  const [switches, setSwitches] = useState<NotificationSwitches | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setSwitches(await notificationsApi.settings());
    } catch (caught) {
      setSwitches(null);
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not load the notification settings.",
      );
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function toggle(key: keyof NotificationSwitches, value: boolean) {
    // Moved here first, then saved. A switch that waits for a round trip
    // before it moves is one somebody clicks twice.
    setSwitches((current) => (current ? { ...current, [key]: value } : current));
    try {
      await notificationsApi.updateSettings({ [key]: value });
    } catch {
      toast.show("That did not save.", "error");
      await load();
    }
  }

  if (error) {
    return (
      <Card className="px-5 py-4">
        <p className="text-sm text-negative">{error}</p>
      </Card>
    );
  }

  if (!switches) {
    return (
      <Card className="flex items-center justify-center gap-2 px-6 py-12 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        Loading…
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          title="What raises a notification"
          description="The bell in the top bar. Checked every morning at 9am Dhaka time."
        />
        <CardBody className="flex flex-col gap-3">
          {EVENTS.map((event) => (
            <Switch
              key={event.key}
              label={event.label}
              detail={event.detail}
              checked={switches[event.key]}
              disabled={!canWrite}
              onChange={(value) => void toggle(event.key, value)}
            />
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Watching what people change"
          description="Off by default, and to super admins only."
        />
        <CardBody className="flex flex-col gap-3">
          <Switch
            label="Somebody changed something significant"
            detail="A voided money row, or a change to somebody's pay. Not everything: the audit log catches every write in this app, and a bell wired to all of it is one nobody looks at within a week."
            checked={switches.significantChanges}
            disabled={!canWrite}
            onChange={(value) => void toggle("significantChanges", value)}
          />
          <p className="text-xs text-muted-foreground">
            The notification names what changed and does not repeat it — a
            notification quoting a salary would move the leak that the audit
            screen&apos;s own sensitivity filter exists to prevent. The figure
            is on <span className="font-medium">What changed</span>, for the
            people allowed to read it.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Try it"
          description="Runs this morning's check now, against today's real data."
        />
        <CardBody className="flex flex-col gap-2">
          <div>
            <Button
              variant="secondary"
              disabled={!canWrite || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await notificationsApi.run();
                  toast.show(result.message, "success");
                } catch (caught) {
                  toast.show(
                    caught instanceof Error
                      ? caught.message
                      : "That did not work.",
                    "error",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : null}
              Check now
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            A job that only exists inside a schedule cannot be tried without
            waiting until tomorrow. Raising is guarded by the database, so
            pressing this twice still raises once — and nothing already read
            comes back.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function Switch({
  label,
  detail,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        className="mt-0.5 size-4 accent-[var(--primary)]"
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="text-sm">
        {label}
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {detail}
        </span>
      </span>
    </label>
  );
}

"use client";

import type { Icon } from "@phosphor-icons/react";
import { BellRingingIcon } from "@phosphor-icons/react/dist/ssr/BellRinging";
import { CalendarCheckIcon } from "@phosphor-icons/react/dist/ssr/CalendarCheck";
import { EyeIcon } from "@phosphor-icons/react/dist/ssr/Eye";
import { FlaskIcon } from "@phosphor-icons/react/dist/ssr/Flask";
import { MoneyIcon } from "@phosphor-icons/react/dist/ssr/Money";
import { PercentIcon } from "@phosphor-icons/react/dist/ssr/Percent";
import { PiggyBankIcon } from "@phosphor-icons/react/dist/ssr/PiggyBank";
import { PlayIcon } from "@phosphor-icons/react/dist/ssr/Play";
import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Switch, SwitchRow } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import {
  ApiError,
  notificationsApi,
  type NotificationSwitches,
} from "@/lib/api-client";

/**
 * Settings → Notifications.
 *
 * Five switches and a button, and the page's whole job is making the one that
 * watches colleagues read differently from the rest. Three are a date
 * arriving — a renewal, a deadline, a month that ended — and a fourth is a
 * request arriving from the HR portal (#122); a person either wants to be
 * told or does not. The last watches what colleagues do, which is a
 * different kind of decision, so it sits apart and says who it tells.
 */

const EVENTS: {
  key: keyof NotificationSwitches;
  icon: Icon;
  label: string;
  detail: string;
}[] = [
  {
    key: "renewals",
    icon: CalendarCheckIcon,
    label: "A plan renews in three days",
    detail:
      "Three days is enough to cancel it, change it, or make sure the card has room. The same trigger sends the email, and switching one off leaves the other running.",
  },
  {
    key: "tdsDeadline",
    icon: PercentIcon,
    label: "The TDS deposit deadline is near",
    detail:
      "Only when something is still undeposited. Two weeks after month end, and tighter in June — the 29th and 30th are same-day.",
  },
  {
    key: "payrollUnpaid",
    icon: MoneyIcon,
    label: "A month ended and its payroll is not paid",
    detail: "Raised once for that month, not once a day until it is.",
  },
  {
    /* The owner, 30 Sep 2026: "Hr budget a kono request asle setao jate
       notifications jay oi option ta rakho ekhane". */
    key: "hrBudget",
    icon: PiggyBankIcon,
    label: "HR sent a money request",
    detail:
      "A pay change, a one-off, a budget or a spend from the HR portal — the moment it arrives, not at 9am, once per request, to the people who decide it. Sent again with changes, it does not ring twice.",
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
    setSwitches((current) =>
      current ? { ...current, [key]: value } : current,
    );
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
          icon={BellRingingIcon}
          description="The bell in the top bar. Checked every morning at 9am Dhaka time."
        />
        <CardBody className="flex flex-col gap-2.5 px-5 py-4">
          {EVENTS.map((event) => (
            <EventRow
              key={event.key}
              icon={event.icon}
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
          icon={EyeIcon}
          description="Off by default, and to super admins only."
        />
        <CardBody className="flex flex-col gap-2.5 px-5 py-4">
          <SwitchRow
            title="Somebody changed something significant"
            description="A voided money row, or a change to somebody's pay. Not everything: the audit log catches every write in this app, and a bell wired to all of it is one nobody looks at within a week."
            checked={switches.significantChanges}
            disabled={!canWrite}
            onChange={(value) => void toggle("significantChanges", value)}
          />
          <p className="text-[12.5px] leading-normal text-(--sv-muted)">
            The notification names what changed and does not repeat it — a
            notification quoting a salary would move the leak that the audit
            screen&apos;s own sensitivity filter exists to prevent. The figure
            is on <span className="font-medium">What changed</span>, for the
            people allowed to read it.
          </p>
        </CardBody>
      </Card>

      {/* The handoff draws this as a lime band rather than a third card. */}
      <Card className="sv-card-lime flex flex-wrap items-center gap-3.5 bg-(--sv-lime-tint) px-5 py-4.5">
        <FlaskIcon
          weight="duotone"
          size={24}
          className="flex-none text-(--sv-violet)"
        />
        <div className="min-w-60 flex-1">
          <h2 className="text-[15px] font-extrabold">Try it</h2>
          <p className="text-[12.5px] leading-normal text-(--sv-muted)">
            Runs this morning&apos;s check now, against today&apos;s real data.
          </p>
          <p className="mt-1 text-[12.5px] leading-normal text-(--sv-muted)">
            A job that only exists inside a schedule cannot be tried without
            waiting until tomorrow. Raising is guarded by the database, so
            pressing this twice still raises once — and nothing already read
            comes back.
          </p>
        </div>
        <Button
          variant="primary"
          disabled={!canWrite || busy}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await notificationsApi.run();
              toast.show(result.message, "success");
            } catch (caught) {
              toast.show(
                caught instanceof Error ? caught.message : "That did not work.",
                "error",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <PlayIcon weight="duotone" size={17} />
          )}
          Check now
        </Button>
      </Card>
    </div>
  );
}

/**
 * A notification type's row: the switch, the type's icon, its name and what it
 * means. `SwitchRow` with a violet icon between the switch and the words, as
 * the handoff draws these three — the same row, the same click-the-name rule.
 */
function EventRow({
  icon: EventIcon,
  label,
  detail,
  checked,
  disabled,
  onChange,
}: {
  icon: Icon;
  label: string;
  detail: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="sv-switch-row flex items-start gap-3.5 rounded-[11px] bg-(--sv-subtle) px-4 py-3.5">
      <Switch
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        labelledBy={`${id}-title`}
        describedBy={`${id}-description`}
      />
      <EventIcon
        weight="duotone"
        size={21}
        aria-hidden="true"
        className="flex-none text-(--sv-violet)"
      />
      <div className="min-w-0 flex-1">
        <p
          id={`${id}-title`}
          onClick={() => !disabled && onChange(!checked)}
          className={
            disabled
              ? "text-[14.5px] font-extrabold"
              : "cursor-pointer text-[14.5px] font-extrabold"
          }
        >
          {label}
        </p>
        <p
          id={`${id}-description`}
          className="mt-0.5 text-[12.5px] leading-normal text-(--sv-muted)"
        >
          {detail}
        </p>
      </div>
    </div>
  );
}

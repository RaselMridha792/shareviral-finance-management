"use client";

import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/ssr/EnvelopeSimple";
import { GlobeIcon } from "@phosphor-icons/react/dist/ssr/Globe";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/dist/ssr/PaperPlaneTilt";
import { PlayIcon } from "@phosphor-icons/react/dist/ssr/Play";
import { TrayIcon } from "@phosphor-icons/react/dist/ssr/Tray";
import { WarningIcon } from "@phosphor-icons/react/dist/ssr/Warning";
import { Check, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/patterns";
import { SwitchRow } from "@/components/ui/switch";
import {
  SerialCell,
  SerialHead,
  TableMessageRow,
  TableScroll,
  Th,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { ApiError, emailApi, type EmailStatus } from "@/lib/api-client";

/**
 * Settings → Email.
 *
 * The screen has one job beyond collecting three values: making it obvious
 * that pasting a key is not the same as being able to send. Mail arrives
 * because a domain is verified, and that happens in DNS, on a registrar, in
 * somebody else's account — so the page says which records to add and then
 * offers the only honest test there is, which is sending one.
 */

/**
 * What Resend asks for.
 *
 * Deliberately not hard-coded values. Resend generates the DKIM key per
 * domain, so the exact records live in their dashboard and printing invented
 * ones here would be worse than printing none — somebody would paste them and
 * wonder why verification never completed.
 */
const DNS_STEPS = [
  {
    what: "SPF",
    why: "Says this sender may send as your domain. Without it most mail is refused outright.",
  },
  {
    what: "DKIM",
    why: "Signs each message so it cannot be altered in transit. Resend generates this one per domain — copy it from their dashboard.",
  },
  {
    what: "DMARC",
    why: "Tells other mail servers what to do when the first two disagree. Optional, and the difference between inbox and spam folder for some recipients.",
  },
];

export function EmailPanel() {
  const canWrite = useCan("settings.write");
  const toast = useToast();

  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");

  const load = useCallback(async () => {
    try {
      setError(null);
      setStatus(await emailApi.status());
    } catch (caught) {
      // Not an empty state. A request that did not answer says nothing about
      // whether email is configured.
      setStatus(null);
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not load the email settings.",
      );
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function run(label: string, fn: () => Promise<string>) {
    setBusy(label);
    try {
      toast.show(await fn(), "success");
      await load();
    } catch (caught) {
      // Both kinds carry a message worth showing: `ApiError` from the server,
      // and a plain `Error` thrown here when the server answered 200 with a
      // refusal in the body — "a Resend key starts with re_" is a sentence
      // somebody needs to read, not a generic failure.
      toast.show(
        caught instanceof Error ? caught.message : "That did not work.",
        "error",
      );
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <Card className="px-5 py-4">
        <p className="text-sm text-negative">{error}</p>
      </Card>
    );
  }

  if (!status) {
    return (
      <Card className="flex items-center justify-center gap-2 px-6 py-12 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        Loading…
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* --- what it can and cannot do right now --------------------------- */}
      <Card>
        <CardHeader
          title="Sending"
          icon={EnvelopeSimpleIcon}
          description="Renewal reminders go out at 9am Dhaka time, three days before a plan renews."
          action={
            status.blockedBy ? (
              <StatusPill tone="warning">Not sending</StatusPill>
            ) : (
              <StatusPill tone="positive">Ready</StatusPill>
            )
          }
        />
        <CardBody className="flex flex-col gap-4">
          {status.blockedBy ? (
            <p className="sv-warn-note flex items-start gap-2.5 rounded-[11px] bg-(--sv-warn-tint) px-3.5 py-3 text-[13.5px] leading-[1.45] font-extrabold text-(--sv-warn)">
              <WarningIcon weight="duotone" size={19} className="flex-none" />
              {status.blockedBy}
            </p>
          ) : null}

          <Field
            label="Resend API key"
            hint={
              status.configured
                ? `Saved${status.keySetAt ? ` on ${status.keySetAt.slice(0, 10)}` : ""}. Paste a new one to replace it — the saved key is never shown again.`
                : "From resend.com → API Keys. Starts with re_."
            }
          >
            <div className="flex items-center gap-2">
              <Input
                type="password"
                value={apiKey}
                placeholder={status.configured ? "••••••••••••" : "re_…"}
                autoComplete="off"
                disabled={!canWrite}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <Button
                variant="secondary"
                // As tall as the key box beside it, as the handoff lines them up.
                className="h-10 px-3.5 text-[13.5px]"
                disabled={!canWrite || !apiKey.trim() || busy !== null}
                onClick={() =>
                  run("key", async () => {
                    const result = await emailApi.setKey(apiKey.trim());
                    setApiKey("");
                    if (!result.saved)
                      throw new Error(result.message ?? "Not saved.");
                    return "Key saved.";
                  })
                }
              >
                Save
              </Button>
            </div>
          </Field>

          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field
              label="Mail appears to be from"
              hint="Must be on a domain Resend has verified — see below."
            >
              <Input
                type="email"
                defaultValue={status.from ?? ""}
                placeholder="finance@hellonizam.com"
                disabled={!canWrite}
                onBlur={(e) =>
                  e.target.value !== (status.from ?? "") &&
                  run("from", async () => {
                    await emailApi.update({ from: e.target.value });
                    return "Saved.";
                  })
                }
              />
            </Field>

            <Field
              label="Copy every reminder to"
              hint="The admin address. Reminders also go to the login account, every CFO and every super admin — and the test button below sends here too, so you can check it now rather than at the next renewal."
            >
              <Input
                type="email"
                defaultValue={status.adminAddress ?? ""}
                placeholder="admin@hellonizam.com"
                disabled={!canWrite}
                onBlur={(e) =>
                  e.target.value !== (status.adminAddress ?? "") &&
                  run("admin", async () => {
                    await emailApi.update({ adminAddress: e.target.value });
                    return "Saved.";
                  })
                }
              />
            </Field>
          </div>

          {/*
            The switch is separate from having a key on purpose. A mailer that
            starts sending the moment somebody pastes a key is how a test
            message reaches a customer.
          */}
          <SwitchRow
            title="Send email"
            description="Nothing is sent while this is off, whatever else is saved."
            checked={status.enabled}
            disabled={!canWrite || busy !== null}
            onChange={(next) =>
              run("enabled", async () => {
                await emailApi.update({ enabled: next });
                return next ? "Email switched on." : "Email switched off.";
              })
            }
          />

          {/*
            Who else a reminder reaches.

            Separate from the address above because they answer different
            questions: that one is "who do I want copied", this one is "are the
            sign-in addresses real inboxes". This company's super admin signs in
            as an address with no mailbox behind it, so every reminder sent
            there bounces — and a provider that scores senders counts those
            against the mail that matters.
          */}
          <SwitchRow
            title="Also send to everybody who can sign in as CFO or super admin"
            description="Turn this off if those are logins rather than real mailboxes. Mail to an address that does not exist bounces, and enough bounces send the rest to spam."
            checked={status.toStaff}
            disabled={!canWrite || busy !== null}
            onChange={(next) =>
              run("staff", async () => {
                await emailApi.update({ toStaff: next });
                return next
                  ? "Reminders will also go to everybody who can sign in."
                  : "Reminders will go only to the addresses above.";
              })
            }
          />

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={!canWrite || busy !== null}
              onClick={() =>
                run("test", async () => {
                  const result = await emailApi.test();
                  if (!result.sent) throw new Error(result.message);
                  return result.message;
                })
              }
            >
              {busy === "test" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <PaperPlaneTiltIcon
                  weight="duotone"
                  size={17}
                  className="text-(--sv-violet)"
                />
              )}
              Send a test
            </Button>

            <Button
              variant="secondary"
              disabled={!canWrite || busy !== null}
              onClick={() =>
                run("reminders", async () => {
                  const result = await emailApi.runReminders();
                  return result.message;
                })
              }
            >
              {busy === "reminders" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <PlayIcon
                  weight="duotone"
                  size={17}
                  className="text-(--sv-violet)"
                />
              )}
              Run today&apos;s reminders now
            </Button>
          </div>
          <p className="text-[12.5px] leading-normal text-(--sv-muted)">
            The test goes to you <em>and</em> to the address above, so it proves
            the key, the domain, and the inbox the copies are meant to reach —
            which is the one worth proving, since it is usually on somebody
            else&apos;s domain. The second button proves the reminder itself:
            which plans it finds and who it tells. It obeys the same rule as the
            daily job, so pressing it twice still sends once.
          </p>
          <p className="text-[12.5px] leading-normal text-(--sv-muted)">
            &ldquo;Sent&rdquo; means Resend accepted it, which is not the same
            as it arriving — an address with no mailbox behind it is accepted
            and bounces afterwards. If a test says it sent and nothing turns up,
            that address is where to look first.
          </p>
        </CardBody>
      </Card>

      {/* --- DNS ----------------------------------------------------------- */}
      <Card>
        <CardHeader
          title="Making mail arrive"
          icon={GlobeIcon}
          description="Pasting a key is not enough. Until the domain is verified, most of what you send lands in spam or is refused."
        />
        <CardBody className="flex flex-col gap-4">
          {/* The steps on the left, the records they add on the right. */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4.5">
            <ol className="flex flex-col gap-2.5 text-sm">
              <Step n={1}>
                In Resend, add <strong>hellonizam.com</strong> under Domains.
              </Step>
              <Step n={2}>
                It shows three records. Add them at whoever hosts your DNS.
              </Step>
              <Step n={3}>
                Press Verify there. It usually takes minutes and can take a day.
              </Step>
            </ol>

            <div className="flex flex-col gap-2">
              {DNS_STEPS.map((step) => (
                <div
                  key={step.what}
                  className="sv-chip flex gap-3 rounded-[11px] bg-(--sv-subtle) px-3 py-2.5 text-[13px]"
                >
                  <b className="w-14 flex-none font-extrabold text-(--sv-violet-ink)">
                    {step.what}
                  </b>
                  <span className="text-(--sv-muted)">{step.why}</span>
                </div>
              ))}
            </div>
          </div>

          {/*
            The values are not printed here, and that is deliberate. Resend
            generates the DKIM key per domain, so anything written into this
            file would be a guess — and a guess somebody pastes into DNS is
            worse than no guess at all, because verification then fails for a
            reason nobody can see.
          */}
          <p className="text-[12.5px] leading-normal text-(--sv-muted)">
            The exact values are in Resend&apos;s dashboard, not here — the DKIM
            key is generated for your domain, so anything printed on this page
            would be a guess somebody pasted into DNS.
          </p>
        </CardBody>
      </Card>

      {/* --- what has been sent -------------------------------------------- */}
      <Card className="overflow-hidden p-0">
        <CardHeader
          title="What has gone out"
          icon={TrayIcon}
          description="Every reminder, and whether it arrived at the provider."
        />
        <TableScroll>
          <table className="table-data min-w-[720px]">
            <thead>
              <tr>
                <SerialHead />
                <Th width="w-40">When</Th>
                <Th>To</Th>
                <Th width="w-40">About</Th>
                <Th width="w-28">Outcome</Th>
              </tr>
            </thead>
            <tbody>
              {status.recent.length === 0 ? (
                <TableMessageRow colSpan={5}>
                  Nothing sent yet. Reminders appear here as they go out.
                </TableMessageRow>
              ) : (
                status.recent.map((row, index) => (
                  <tr key={row.id} className="row-finance">
                    <SerialCell n={index + 1} />
                    <td className="num whitespace-nowrap">
                      {row.sentAt.slice(0, 16).replace("T", " ")}
                    </td>
                    <td>{row.recipient}</td>
                    <td className="num text-xs text-muted-foreground">
                      {row.subjectDate ?? "N/A"}
                    </td>
                    <td>
                      {row.outcome === "sent" ? (
                        <StatusPill tone="positive">
                          <Check className="mr-1 size-3" />
                          Sent
                        </StatusPill>
                      ) : (
                        <StatusPill tone="negative">
                          <span title={row.error ?? undefined}>Failed</span>
                        </StatusPill>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableScroll>
      </Card>
    </div>
  );
}

/** One step of verifying the domain, numbered in a lime circle. */
function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className="grid size-6.5 flex-none place-items-center rounded-full bg-(--sv-accent) text-[12px] font-extrabold text-(--sv-on-accent)">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

"use client";

import { Check, LoaderCircle, Send, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/patterns";
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
            <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
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

          <div className="grid gap-4 sm:grid-cols-2">
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
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5">
            <input
              type="checkbox"
              checked={status.enabled}
              disabled={!canWrite || busy !== null}
              className="mt-0.5 size-4 accent-[var(--primary)]"
              onChange={(e) =>
                run("enabled", async () => {
                  await emailApi.update({ enabled: e.target.checked });
                  return e.target.checked
                    ? "Email switched on."
                    : "Email switched off.";
                })
              }
            />
            <span className="text-sm">
              Send email
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Nothing is sent while this is off, whatever else is saved.
              </span>
            </span>
          </label>

          {/*
            Who else a reminder reaches.

            Separate from the address above because they answer different
            questions: that one is "who do I want copied", this one is "are the
            sign-in addresses real inboxes". This company's super admin signs in
            as an address with no mailbox behind it, so every reminder sent
            there bounces — and a provider that scores senders counts those
            against the mail that matters.
          */}
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5">
            <input
              type="checkbox"
              checked={status.toStaff}
              disabled={!canWrite || busy !== null}
              className="mt-0.5 size-4 accent-[var(--primary)]"
              onChange={(e) =>
                run("staff", async () => {
                  await emailApi.update({ toStaff: e.target.checked });
                  return e.target.checked
                    ? "Reminders will also go to everybody who can sign in."
                    : "Reminders will go only to the addresses above.";
                })
              }
            />
            <span className="text-sm">
              Also send to everybody who can sign in as CFO or super admin
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Turn this off if those are logins rather than real mailboxes.
                Mail to an address that does not exist bounces, and enough
                bounces send the rest to spam.
              </span>
            </span>
          </label>

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
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
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
              Run today&apos;s reminders now
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            The test goes to you <em>and</em> to the address above, so it proves
            the key, the domain, and the inbox the copies are meant to reach —
            which is the one worth proving, since it is usually on somebody
            else&apos;s domain. The second button proves the reminder itself:
            which plans it finds and who it tells. It obeys the same rule as
            the daily job, so pressing it twice still sends once.
          </p>
          <p className="text-xs text-muted-foreground">
            &ldquo;Sent&rdquo; means Resend accepted it, which is not the same
            as it arriving — an address with no mailbox behind it is accepted
            and bounces afterwards. If a test says it sent and nothing turns
            up, that address is where to look first.
          </p>
        </CardBody>
      </Card>

      {/* --- DNS ----------------------------------------------------------- */}
      <Card>
        <CardHeader
          title="Making mail arrive"
          description="Pasting a key is not enough. Until the domain is verified, most of what you send lands in spam or is refused."
        />
        <CardBody className="flex flex-col gap-3">
          <ol className="flex flex-col gap-2 text-sm">
            <li className="flex gap-2">
              <span className="num text-muted-foreground">1.</span>
              <span>
                In Resend, add <strong>hellonizam.com</strong> under Domains.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="num text-muted-foreground">2.</span>
              <span>
                It shows three records. Add them at whoever hosts your DNS.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="num text-muted-foreground">3.</span>
              <span>
                Press Verify there. It usually takes minutes and can take a day.
              </span>
            </li>
          </ol>

          <div className="flex flex-col gap-2 border-t border-border pt-3">
            {DNS_STEPS.map((step) => (
              <div key={step.what} className="flex gap-3 text-sm">
                <span className="w-14 shrink-0 font-medium">{step.what}</span>
                <span className="text-muted-foreground">{step.why}</span>
              </div>
            ))}
          </div>

          {/*
            The values are not printed here, and that is deliberate. Resend
            generates the DKIM key per domain, so anything written into this
            file would be a guess — and a guess somebody pastes into DNS is
            worse than no guess at all, because verification then fails for a
            reason nobody can see.
          */}
          <p className="text-xs text-muted-foreground">
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

"use client";

import {
  Check,
  Copy,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  ShieldOff,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ApiError } from "@/lib/api-client";
import {
  twoFactorApi,
  type TwoFactorSetup,
  type TwoFactorStatus,
} from "@/lib/two-factor";

/**
 * Your own second factor. Not an administrator's screen — there is no way to
 * see or change anybody else's from here, and nothing on this page needs a
 * permission, because everybody has exactly one account to protect.
 *
 * Signing in does not ask for a code yet. Enrolment ships first on purpose: it
 * lets all five people add their authenticator and check it works before the
 * check at sign-in is switched on. The other order locks a finance team out of
 * its own books.
 */

type Stage =
  | { name: "idle" }
  | { name: "password" }
  | { name: "scan"; setup: TwoFactorSetup }
  | { name: "codes"; codes: string[] };

export function SecurityPanel() {
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  useEffect(() => {
    let live = true;
    twoFactorApi
      .status()
      .then((next) => {
        if (live) setStatus(next);
      })
      .catch(() => {
        if (live) setError("Could not read the two-factor status.");
      });
    return () => {
      live = false;
    };
  }, []);

  const reset = () => {
    setPassword("");
    setCode("");
    setError(null);
  };

  const run = async (work: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Something went wrong. Try again.",
      );
    } finally {
      setPending(false);
    }
  };

  const startSetup = () =>
    run(async () => {
      const setup = await twoFactorApi.beginSetup(password);
      setPassword("");
      setStage({ name: "scan", setup });
    });

  const confirmSetup = () =>
    run(async () => {
      const { recoveryCodes } = await twoFactorApi.confirm(code);
      setCode("");
      setStage({ name: "codes", codes: recoveryCodes });
      setStatus(await twoFactorApi.status());
    });

  const disable = () =>
    run(async () => {
      await twoFactorApi.disable(password, code);
      reset();
      setStage({ name: "idle" });
      setStatus(await twoFactorApi.status());
    });

  const newCodes = () =>
    run(async () => {
      const { recoveryCodes } = await twoFactorApi.regenerateRecoveryCodes(
        password,
        code,
      );
      reset();
      setStage({ name: "codes", codes: recoveryCodes });
      setStatus(await twoFactorApi.status());
    });

  if (!status) {
    return (
      <Card>
        <CardBody className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Reading your security settings…
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Two-step sign-in"
          description="A six-digit code from your phone, on top of your password."
        />
        <CardBody className="flex flex-col gap-4">
          <div className="flex items-start gap-3 rounded-lg bg-surface-muted px-4 py-3">
            {status.enrolled ? (
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-positive" />
            ) : (
              <ShieldOff className="mt-0.5 size-4 shrink-0 text-warning" />
            )}
            <div className="text-sm">
              {status.enrolled ? (
                <>
                  <p>
                    Switched on for your account.{" "}
                    <span className="text-muted-foreground">
                      {status.recoveryCodesLeft} recovery code
                      {status.recoveryCodesLeft === 1 ? "" : "s"} left.
                    </span>
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Sign-in does not ask for the code yet. It will once everyone
                    has set this up — nothing you do here can lock you out in
                    the meantime.
                  </p>
                </>
              ) : (
                <p>
                  Not set up. Your password is currently the only thing between
                  a stranger and this company&apos;s figures — and a password is
                  the part that leaks.
                </p>
              )}
            </div>
          </div>

          {error ? (
            <p className="flex items-start gap-2 rounded-lg bg-negative/10 px-4 py-3 text-sm text-negative">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          ) : null}

          {/* ---------------------------------------------------- enrolling */}

          {!status.enrolled && stage.name === "idle" ? (
            <div>
              <Button
                variant="primary"
                onClick={() => {
                  reset();
                  setStage({ name: "password" });
                }}
              >
                Set up two-step sign-in
              </Button>
            </div>
          ) : null}

          {stage.name === "password" ? (
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void startSetup();
              }}
            >
              <Field
                label="Your password"
                hint="Asked again so that somebody using your open session cannot quietly swap the second factor for their own."
              >
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </Field>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" disabled={pending}>
                  {pending ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : null}
                  Continue
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    reset();
                    setStage({ name: "idle" });
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}

          {stage.name === "scan" ? (
            <ScanStep
              setup={stage.setup}
              code={code}
              onCode={setCode}
              pending={pending}
              onConfirm={() => void confirmSetup()}
              onCancel={() => {
                reset();
                setStage({ name: "idle" });
              }}
            />
          ) : null}

          {stage.name === "codes" ? (
            <RecoveryCodes
              codes={stage.codes}
              onDone={() => {
                reset();
                setStage({ name: "idle" });
              }}
            />
          ) : null}

          {/* ------------------------------------------- already switched on */}

          {status.enrolled && stage.name === "idle" ? (
            <ManageEnrolled
              password={password}
              code={code}
              pending={pending}
              onPassword={setPassword}
              onCode={setCode}
              onDisable={() => void disable()}
              onNewCodes={() => void newCodes()}
            />
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ScanStep({
  setup,
  code,
  onCode,
  pending,
  onConfirm,
  onCancel,
}: {
  setup: TwoFactorSetup;
  code: string;
  onCode: (next: string) => void;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm();
      }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {/*
          The markup comes from the API, which builds it with qrcode-generator
          and asserts in its own tests that it is rectangles and a path: no
          script, no text nodes, and neither the secret nor the URL inside it.
          That is why this injection is allowed rather than merely convenient.
        */}
        <div
          className="shrink-0 self-center rounded-lg bg-white p-3 sm:self-start"
          dangerouslySetInnerHTML={{ __html: setup.qrSvg }}
          style={{ width: 200, height: 200 }}
          role="img"
          aria-label="QR code for your authenticator app"
        />

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <p className="text-sm">
            Open an authenticator app — Google Authenticator, Microsoft
            Authenticator, 1Password, Aegis — and scan this.
          </p>
          <SecretKey secret={setup.secret} />
        </div>
      </div>

      <Field
        label="Then type the six digits it shows"
        hint="If it says the code is wrong, check the phone's clock is set automatically. A clock a minute out is the usual cause."
      >
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          className="num tracking-[0.3em]"
          value={code}
          onChange={(event) => onCode(event.target.value)}
          required
        />
      </Field>

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Turn it on
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** For a phone with no camera to hand, or a desktop password manager. */
function SecretKey({ secret }: { secret: string }) {
  const grouped = secret.replace(/(.{4})(?=.)/g, "$1 ");
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">
        Or type this key in by hand
      </span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-muted px-3 py-2 font-mono text-xs">
          {grouped}
        </code>
        <CopyButton value={secret} label="key" />
      </div>
    </div>
  );
}

function RecoveryCodes({
  codes,
  onDone,
}: {
  codes: string[];
  onDone: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-warning/40 bg-warning/5 p-4">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="text-sm">
          <p className="font-medium">
            Save these now — this is the only time they are shown.
          </p>
          <p className="mt-1 text-muted-foreground">
            Each one signs you in once if your phone is lost, broken or wiped.
            Only their fingerprints are kept on the server, so nobody can read
            them back to you — not an administrator, not this application.
            Print them, or put them somewhere that is not the phone.
          </p>
        </div>
      </div>

      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {codes.map((entry) => (
          <li
            key={entry}
            className="rounded bg-surface px-3 py-2 font-mono text-sm tracking-wide"
          >
            {entry}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <CopyButton value={codes.join("\n")} label="codes" />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => window.print()}
        >
          Print
        </Button>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        <span>I have saved these somewhere safe.</span>
      </label>

      <div>
        <Button
          type="button"
          variant="primary"
          disabled={!acknowledged}
          onClick={onDone}
        >
          Done
        </Button>
      </div>
    </div>
  );
}

function ManageEnrolled({
  password,
  code,
  pending,
  onPassword,
  onCode,
  onDisable,
  onNewCodes,
}: {
  password: string;
  code: string;
  pending: boolean;
  onPassword: (next: string) => void;
  onCode: (next: string) => void;
  onDisable: () => void;
  onNewCodes: () => void;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div>
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          New recovery codes, or turn this off
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <p className="text-sm text-muted-foreground">
        Both are asked for either action. A recovery code works here too, if the
        phone is already gone.
      </p>
      <Field label="Your password">
        <Input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => onPassword(event.target.value)}
        />
      </Field>
      <Field label="Code from your app, or a recovery code">
        <Input
          autoComplete="one-time-code"
          placeholder="123456"
          className="num"
          value={code}
          onChange={(event) => onCode(event.target.value)}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={pending || !password || !code}
          onClick={onNewCodes}
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Get new recovery codes
        </Button>
        <Button
          type="button"
          variant="danger"
          disabled={pending || !password || !code}
          onClick={onDisable}
        >
          Turn two-step off
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Turning it off deletes the enrolment and every unused recovery code.
      </p>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => setCopied(true));
      }}
    >
      {copied ? (
        <Check className="size-3.5 text-positive" />
      ) : (
        <Copy className="size-3.5" />
      )}
      {copied ? "Copied" : `Copy ${label}`}
    </Button>
  );
}

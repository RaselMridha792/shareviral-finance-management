"use client";

import type { Icon } from "@phosphor-icons/react";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { CircleNotchIcon } from "@phosphor-icons/react/dist/ssr/CircleNotch";
import { ClockCountdownIcon } from "@phosphor-icons/react/dist/ssr/ClockCountdown";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/ssr/EnvelopeSimple";
import { EyeIcon } from "@phosphor-icons/react/dist/ssr/Eye";
import { EyeSlashIcon } from "@phosphor-icons/react/dist/ssr/EyeSlash";
import { HeadsetIcon } from "@phosphor-icons/react/dist/ssr/Headset";
import { KeyIcon } from "@phosphor-icons/react/dist/ssr/Key";
import { LockKeyIcon } from "@phosphor-icons/react/dist/ssr/LockKey";
import { PasswordIcon } from "@phosphor-icons/react/dist/ssr/Password";
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/ssr/ShieldCheck";
import { SignInIcon } from "@phosphor-icons/react/dist/ssr/SignIn";
import { SignOutIcon } from "@phosphor-icons/react/dist/ssr/SignOut";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import { startBoot } from "@/components/boot/boot-overlay";
import { ApiError, login, verifySecondStep } from "@/lib/api-client";

/** Why somebody is on this page, when the URL says. */
export type ArrivalNotice = "idle" | "signed-out";

/**
 * The violet line above the fields. Two kinds arrive with the page; two are
 * answers to the two questions the page offers to answer.
 *
 * "Forgot password?" and "Contact admin" are in the handoff as links. There is
 * nowhere for them to go: this app has no self-service reset — a Super Admin
 * sets a new password from Settings — and no address a stranger could be given.
 * A link to nowhere is worse than no link, so each says where the answer is.
 */
const NOTES: Record<
  ArrivalNotice | "forgot" | "access",
  { text: string; Icon: Icon }
> = {
  "signed-out": { text: "You have signed out.", Icon: SignOutIcon },
  /**
   * Without this an idle sign-out is indistinguishable from something having
   * gone wrong, and "it logged me out for no reason" is how a security control
   * gets asked to be turned off.
   */
  idle: {
    text: "Your session expired. Please sign in again.",
    Icon: ClockCountdownIcon,
  },
  forgot: {
    text: "An administrator sets a new one from Settings → People who can sign in.",
    Icon: KeyIcon,
  },
  access: {
    text: "Sign-in accounts are made by an administrator. Ask them to add you.",
    Icon: HeadsetIcon,
  },
};

type Note = keyof typeof NOTES;

/** idle → sending → done. "done" is the session existing; the preloader takes it from there. */
type Stage = "idle" | "sending" | "done";

export function LoginForm({
  next,
  notice,
}: {
  next: string;
  notice: ArrivalNotice | null;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("idle");
  const [note, setNote] = useState<Note | null>(notice);
  /**
   * Held here and nowhere else.
   *
   * It is a credential with five minutes to live. localStorage would leave it
   * lying about for any script to pick up, and a cookie would have the browser
   * attaching it to requests nobody asked for. React state dies with the page,
   * which for something this short-lived is the correct storage.
   */
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  /** Typing a password nobody can read is how a typo becomes "wrong password". */
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which box the error is about, so that box takes the violet edge. */
  const [invalid, setInvalid] = useState<{
    email?: boolean;
    password?: boolean;
  }>({});

  /** The session exists. Hand over to the preloader and go. */
  function enter() {
    setStage("done");
    startBoot();
    // Replace, not push — the login page must not sit in the back history.
    router.replace(next);
    router.refresh();
  }

  function clearError() {
    if (error) setError(null);
    if (invalid.email || invalid.password) setInvalid({});
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stage !== "idle") return;

    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "");
    const password = String(data.get("password") ?? "");

    // Only emptiness is judged here. Whether an address is well-formed is the
    // API's question, and two answers to it are how they come to disagree.
    if (!email.trim()) {
      setError("Enter your email address.");
      setInvalid({ email: true });
      return;
    }
    if (!password) {
      setError("Enter your password.");
      setInvalid({ password: true });
      return;
    }

    setStage("sending");
    setError(null);
    setInvalid({});

    try {
      const outcome = await login(email, password);

      // The password was right but is not, on its own, a session. No cookie
      // has been set; the code is what completes it.
      if (outcome.twoFactorRequired) {
        setChallenge(outcome.challenge);
        setStage("idle");
        return;
      }

      enter();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        const fields = caught.fieldErrors ?? {};
        setInvalid({
          email: Boolean(fields.email),
          password: Boolean(fields.password),
        });
      } else {
        setError("Can't reach the server. Check that the API is running.");
      }
      setStage("idle");
    }
  }

  async function onSubmitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge || stage !== "idle") return;
    setStage("sending");
    setError(null);

    try {
      await verifySecondStep(challenge, code);
      enter();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        // An expired or rejected challenge cannot be retried with a new code —
        // the password has to be given again — so the form goes back rather
        // than leaving somebody typing codes at a ticket that will never work.
        if (caught.status === 401 && /password again/i.test(caught.message)) {
          setChallenge(null);
          setCode("");
        }
      } else {
        setError("Can't reach the server. Check that the API is running.");
      }
      setStage("idle");
    }
  }

  return (
    <>
      <div className="flex flex-none items-center justify-end gap-2 text-[13px] text-(--sv-muted)">
        Need access?
        <button
          type="button"
          onClick={() => setNote("access")}
          className="sv-ghost-button inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.75 font-extrabold text-(--sv-ink)"
        >
          <HeadsetIcon
            weight="duotone"
            size={16}
            className="text-(--sv-violet)"
          />
          Contact admin
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center py-6">
        <div className="flex w-full max-w-100 flex-col gap-[clamp(10px,2vh,18px)]">
          {challenge ? (
            <SecondStep
              code={code}
              onCode={(value) => {
                setCode(value);
                clearError();
              }}
              stage={stage}
              error={error}
              onSubmit={onSubmitCode}
              onBack={() => {
                setChallenge(null);
                setCode("");
                setError(null);
              }}
            />
          ) : (
            <>
              <Heading
                Icon={LockKeyIcon}
                title="Sign in"
                lede="Use the account your administrator gave you."
              />

              {note ? (
                <NoteLine
                  key={note}
                  {...NOTES[note]}
                  onDismiss={() => setNote(null)}
                />
              ) : null}

              {/*
                method="post" matters even though this form is submitted by
                JavaScript.

                A form with no method is a GET form. Submit it before React has
                hydrated — a slow connection, a stalled bundle, Enter pressed the
                moment the fields appear — and the browser navigates to
                `/login?email=…&password=…`, writing the password into the
                address bar, into browser history, and into the access log of
                anything in front of the app. Nobody would see it happen; the
                page just reloads looking empty.

                With post, that same early submit sends a request the page does
                not answer and goes nowhere. The password stays out of the URL
                either way, which is the whole point.
              */}
              <form
                method="post"
                onSubmit={onSubmit}
                onChange={clearError}
                className="flex flex-col gap-[clamp(10px,2vh,18px)]"
                noValidate
              >
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-extrabold">
                    Email
                  </span>
                  <Field Icon={EnvelopeSimpleIcon} invalid={invalid.email}>
                    <input
                      name="email"
                      type="email"
                      autoComplete="username"
                      required
                      autoFocus
                      placeholder="you@shareviral.cash"
                      aria-invalid={Boolean(invalid.email)}
                    />
                  </Field>
                </label>

                <div>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <label
                      htmlFor="login-password"
                      className="text-[13px] font-extrabold"
                    >
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => setNote("forgot")}
                      className="cursor-pointer text-[13px] font-extrabold text-(--sv-violet-ink) hover:text-(--sv-ink)"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <Field Icon={KeyIcon} invalid={invalid.password} trailing>
                    <input
                      id="login-password"
                      name="password"
                      type={visible ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      placeholder="Enter your password"
                      aria-invalid={Boolean(invalid.password)}
                    />
                    <button
                      type="button"
                      onClick={() => setVisible(!visible)}
                      // Not in the tab order: tabbing from the password box
                      // should reach Sign in, which is what somebody typing
                      // expects.
                      tabIndex={-1}
                      aria-label={
                        visible ? "Hide the password" : "Show the password"
                      }
                      aria-pressed={visible}
                      title={
                        visible ? "Hide the password" : "Show the password"
                      }
                      className="grid size-8.5 flex-none cursor-pointer place-items-center rounded-lg text-(--sv-muted) transition-colors hover:bg-(--sv-violet-tint) hover:text-(--sv-violet)"
                    >
                      {visible ? (
                        <EyeSlashIcon weight="duotone" size={20} />
                      ) : (
                        <EyeIcon weight="duotone" size={20} />
                      )}
                    </button>
                  </Field>
                </div>

                {error ? <ErrorLine>{error}</ErrorLine> : null}

                <SubmitButton
                  stage={stage}
                  idleLabel="Sign in"
                  sendingLabel="Signing in…"
                />
              </form>

              <AttemptsRecorded />
            </>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * The code step.
 *
 * A separate screen rather than a field that appears below the password,
 * because the password is already accepted by this point and leaving it on
 * screen invites somebody to change it and press Enter — which would fail
 * confusingly, since it is the challenge that is being redeemed now, not the
 * password.
 *
 * The handoff draws no screen for it. It is the sign-in screen's own parts —
 * the heading tile, a field, the lime button — so it reads as the next step of
 * the same page rather than as somewhere else.
 */
function SecondStep({
  code,
  onCode,
  stage,
  error,
  onSubmit,
  onBack,
}: {
  code: string;
  onCode: (next: string) => void;
  stage: Stage;
  error: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBack: () => void;
}) {
  /**
   * The API takes either in the same field, so this changes nothing it sends.
   * It exists because a person whose phone is dead does not read the small
   * print under a box marked "Code" - they look for the way out, and if there
   * is no visible way out they conclude they are locked out of the company's
   * accounts. The escape hatch has to be a thing you can see.
   */
  const [useRecovery, setUseRecovery] = useState(false);

  return (
    <>
      <Heading
        Icon={ShieldCheckIcon}
        title={useRecovery ? "Use a recovery code" : "Enter your code"}
        lede={
          useRecovery
            ? "One of the ten codes you saved when you set this up. Each one works once."
            : "The six digits from your authenticator app."
        }
      />

      <form
        method="post"
        onSubmit={onSubmit}
        className="flex flex-col gap-[clamp(10px,2vh,18px)]"
        noValidate
      >
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-extrabold">
            {useRecovery ? "Recovery code" : "Code"}
          </span>
          <Field Icon={useRecovery ? KeyIcon : PasswordIcon}>
            <input
              name="code"
              // Not numeric for a recovery code — a number pad cannot type it.
              inputMode={useRecovery ? "text" : "numeric"}
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              autoFocus
              required
              placeholder={useRecovery ? "XXXX-XXXX-XXXX-XXXX" : "123456"}
              value={code}
              onChange={(event) => onCode(event.target.value)}
              className={`tabular-nums ${useRecovery ? "tracking-wider" : "tracking-[0.3em]"}`}
            />
          </Field>
        </label>

        {error ? <ErrorLine>{error}</ErrorLine> : null}

        <SubmitButton
          stage={stage}
          idleLabel="Sign in"
          sendingLabel="Checking…"
        />

        <div className="flex flex-col items-start gap-2 text-[13px] font-extrabold">
          <button
            type="button"
            onClick={() => {
              setUseRecovery(!useRecovery);
              onCode("");
            }}
            className="cursor-pointer text-(--sv-violet-ink) hover:text-(--sv-ink)"
          >
            {useRecovery
              ? "Use my authenticator app instead"
              : "Lost your phone? Use a recovery code"}
          </button>
          <button
            type="button"
            onClick={onBack}
            className="cursor-pointer text-(--sv-muted) hover:text-(--sv-ink)"
          >
            Start again
          </button>
        </div>
      </form>

      {useRecovery ? (
        <p className="text-[12.5px] leading-normal text-(--sv-muted)">
          No codes left either? An administrator has to clear the enrolment on
          the server — there is deliberately no way to do it from inside the
          app, because anyone who could would be a way around the second step.
        </p>
      ) : null}

      <AttemptsRecorded />
    </>
  );
}

function Heading({
  Icon,
  title,
  lede,
}: {
  Icon: Icon;
  title: string;
  lede: string;
}) {
  return (
    <div className="flex items-center gap-3.5">
      {/* Only where there is height to spare — the handoff drops it first. */}
      <span className="hidden size-11.5 flex-none place-items-center rounded-[11px] bg-(--sv-violet) text-white shadow-[0_8px_18px_rgb(133_88_236/0.28)] [@media(min-height:560px)]:grid">
        <Icon weight="duotone" size={25} />
      </span>
      <div className="min-w-0">
        <h1 className="text-[clamp(24px,3.8vh,30px)] leading-[1.1] font-extrabold tracking-[-0.02em]">
          {title}
        </h1>
        <p className="mt-1 text-[14px] text-(--sv-muted)">{lede}</p>
      </div>
    </div>
  );
}

function NoteLine({
  text,
  Icon,
  onDismiss,
}: {
  text: string;
  Icon: Icon;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="sv-notice flex items-center gap-2.75 rounded-[11px] bg-(--sv-violet-tint) py-2.25 pr-2.5 pl-3"
    >
      <Icon
        weight="duotone"
        size={20}
        className="flex-none text-(--sv-violet)"
      />
      <p className="min-w-0 flex-1 text-[13.5px] font-extrabold text-(--sv-violet-ink)">
        {text}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="grid size-7 flex-none cursor-pointer place-items-center rounded-lg text-(--sv-violet-ink) hover:bg-(--sv-violet-tint-line)"
      >
        <XIcon weight="duotone" size={15} />
      </button>
    </div>
  );
}

/**
 * A text box with its icon inside the border.
 *
 * The box, not the input, takes the focus ring and the error edge — see
 * `.sv-field` in new-design.css for why those two are not utilities.
 */
function Field({
  Icon,
  invalid = false,
  trailing = false,
  children,
}: {
  Icon: Icon;
  invalid?: boolean;
  /** A button sits at the right-hand end, so the padding there is smaller. */
  trailing?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      data-invalid={invalid}
      className={`sv-field flex h-[clamp(40px,5.8vh,48px)] items-center gap-2.5 rounded-[11px] bg-(--sv-subtle) pl-3.5 [&_input]:h-full [&_input]:min-w-0 [&_input]:flex-1 [&_input]:bg-transparent [&_input]:text-[15px] ${
        trailing ? "pr-1.5" : "pr-3.5"
      }`}
    >
      <Icon
        weight="duotone"
        size={20}
        className="flex-none text-(--sv-violet)"
      />
      {children}
    </span>
  );
}

function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="-mt-1 flex items-center gap-2 text-[13px] font-extrabold text-(--sv-violet-ink)"
    >
      <WarningCircleIcon
        weight="duotone"
        size={17}
        className="flex-none text-(--sv-violet)"
      />
      {children}
    </p>
  );
}

function SubmitButton({
  stage,
  idleLabel,
  sendingLabel,
}: {
  stage: Stage;
  idleLabel: string;
  sendingLabel: string;
}) {
  return (
    <button
      type="submit"
      disabled={stage !== "idle"}
      className="sv-primary-button flex h-[clamp(42px,6vh,50px)] cursor-pointer items-center justify-center gap-2.5 rounded-lg bg-(--sv-accent) text-[15px] font-extrabold text-(--sv-on-accent) disabled:cursor-default"
    >
      {stage === "sending" ? (
        <>
          <CircleNotchIcon weight="duotone" size={19} className="sv-spin" />
          {sendingLabel}
        </>
      ) : stage === "done" ? (
        <>
          <CheckCircleIcon weight="duotone" size={20} />
          Signed in — opening the books
        </>
      ) : (
        <>
          <SignInIcon weight="duotone" size={20} />
          {idleLabel}
        </>
      )}
    </button>
  );
}

function AttemptsRecorded() {
  return (
    <p className="flex items-center justify-center gap-1.75 text-center text-[12.5px] text-(--sv-muted)">
      <ShieldCheckIcon
        weight="duotone"
        size={16}
        className="flex-none text-(--sv-violet)"
      />
      Company use only. Every sign-in attempt is recorded.
    </p>
  );
}

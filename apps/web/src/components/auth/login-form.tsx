"use client";

import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiError, login, verifySecondStep } from "@/lib/api-client";

const inputClass =
  "h-10 w-full rounded-lg border border-border bg-surface-muted px-3 text-sm outline-none transition focus-visible:border-primary focus-visible:bg-surface";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    const data = new FormData(event.currentTarget);

    try {
      const outcome = await login(
        String(data.get("email") ?? ""),
        String(data.get("password") ?? ""),
      );

      // The password was right but is not, on its own, a session. No cookie
      // has been set; the code is what completes it.
      if (outcome.twoFactorRequired) {
        setChallenge(outcome.challenge);
        setPending(false);
        return;
      }

      // Replace, not push — the login page must not sit in the back history.
      router.replace(next);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors ?? {});
      } else {
        setError("Can't reach the server. Check that the API is running.");
      }
      setPending(false);
    }
  }

  async function onSubmitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge) return;
    setPending(true);
    setError(null);

    try {
      await verifySecondStep(challenge, code);
      router.replace(next);
      router.refresh();
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
      setPending(false);
    }
  }

  if (challenge) {
    return (
      <SecondStep
        code={code}
        onCode={setCode}
        pending={pending}
        error={error}
        onSubmit={onSubmitCode}
        onBack={() => {
          setChallenge(null);
          setCode("");
          setError(null);
        }}
      />
    );
  }

  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 mb-5 text-sm text-muted-foreground">
        Use the account your administrator gave you.
      </p>

      {/*
        method="post" matters even though this form is submitted by JavaScript.

        A form with no method is a GET form. Submit it before React has
        hydrated — a slow connection, a stalled bundle, Enter pressed the
        moment the fields appear — and the browser navigates to
        `/login?email=…&password=…`, writing the password into the address bar,
        into browser history, and into the access log of anything in front of
        the app. Nobody would see it happen; the page just reloads looking
        empty.

        With post, that same early submit sends a request the page does not
        answer and goes nowhere. The password stays out of the URL either way,
        which is the whole point.
      */}
      <form
        method="post"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
        noValidate
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Email</span>
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            autoFocus
            className={inputClass}
            aria-invalid={Boolean(fieldErrors.email)}
          />
          <FieldError messages={fieldErrors.email} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Password</span>
          {/*
            The eye sits inside the field rather than beside it, so the box
            keeps its full width and the control is where the typing is.
            Padding on the right leaves room for it — without that the last
            characters of a long password disappear under the button.
          */}
          <div className="relative">
            <input
              name="password"
              type={visible ? "text" : "password"}
              autoComplete="current-password"
              required
              className={`${inputClass} pr-11`}
              aria-invalid={Boolean(fieldErrors.password)}
            />
            <button
              type="button"
              onClick={() => setVisible(!visible)}
              // Not in the tab order: tabbing from the password box should
              // reach Sign in, which is what somebody typing expects.
              tabIndex={-1}
              aria-label={visible ? "Hide the password" : "Show the password"}
              aria-pressed={visible}
              title={visible ? "Hide the password" : "Show the password"}
              className="absolute inset-y-0 right-0 flex cursor-pointer items-center rounded-r-lg px-3 text-muted-foreground transition hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {visible ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          </div>
          <FieldError messages={fieldErrors.password} />
        </label>

        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
          >
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={pending}
          className="mt-1 w-full"
        >
          {pending ? (
            <>
              <LoaderCircle className="size-4 animate-spin" />
              Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </Button>
      </form>
    </Card>
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
 */
function SecondStep({
  code,
  onCode,
  pending,
  error,
  onSubmit,
  onBack,
}: {
  code: string;
  onCode: (next: string) => void;
  pending: boolean;
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
    <Card className="p-6">
      <h1 className="text-lg font-semibold tracking-tight">
        {useRecovery ? "Use a recovery code" : "Enter your code"}
      </h1>
      <p className="mt-1 mb-5 text-sm text-muted-foreground">
        {useRecovery
          ? "One of the ten codes you saved when you set this up. Each one works once."
          : "The six digits from your authenticator app."}
      </p>

      <form
        method="post"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
        noValidate
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">
            {useRecovery ? "Recovery code" : "Code"}
          </span>
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
            className={`${inputClass} num ${useRecovery ? "tracking-wider" : "tracking-[0.3em]"}`}
          />
        </label>

        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
          >
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={pending}
          className="mt-1 w-full"
        >
          {pending ? (
            <>
              <LoaderCircle className="size-4 animate-spin" />
              Checking…
            </>
          ) : (
            "Sign in"
          )}
        </Button>

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => {
              setUseRecovery(!useRecovery);
              onCode("");
            }}
            className="cursor-pointer text-left text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            {useRecovery
              ? "Use my authenticator app instead"
              : "Lost your phone? Use a recovery code"}
          </button>
          <button
            type="button"
            onClick={onBack}
            className="cursor-pointer text-left text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Start again
          </button>
        </div>
      </form>

      {useRecovery ? (
        <p className="mt-4 text-xs text-muted-foreground">
          No codes left either? An administrator has to clear the enrolment on
          the server — there is deliberately no way to do it from inside the
          app, because anyone who could would be a way around the second step.
        </p>
      ) : null}
    </Card>
  );
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <span className="text-xs text-negative">{messages[0]}</span>;
}

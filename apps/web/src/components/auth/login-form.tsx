"use client";

import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiError, login } from "@/lib/api-client";

const inputClass =
  "h-10 w-full rounded-lg border border-border bg-surface-muted px-3 text-sm outline-none transition focus-visible:border-primary focus-visible:bg-surface";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
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
      await login(
        String(data.get("email") ?? ""),
        String(data.get("password") ?? ""),
      );
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

  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 mb-5 text-sm text-muted-foreground">
        Use the account your administrator gave you.
      </p>

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
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

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <span className="text-xs text-negative">{messages[0]}</span>;
}

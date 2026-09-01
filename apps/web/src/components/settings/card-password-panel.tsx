"use client";

import { KeyRound, LoaderCircle, ShieldCheck, ShieldOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api-client";
import { accountsApi, type CardPasswordStatus } from "@/lib/masters";
import { formatDate } from "@/lib/utils";

/**
 * Where the card password is set.
 *
 * The owner: *"encryption ta kothay theke setup korbo? etar jonne setting a
 * option rakho ami password set korbo okhane."* The API has had both endpoints
 * since the card fields were added — `GET` and `POST /accounts/card-password` —
 * and nothing on the web ever called them, so the password could not be set at
 * all and no card number could ever be read back.
 *
 * **This is not anybody's sign-in password**, and the panel says so twice. It is
 * one shared secret for the company's cards, and the whole point of it being
 * separate is that knowing somebody's sign-in does not get you their card
 * numbers.
 *
 * **Setting it is `settings.write` — super_admin alone — while USING it is
 * open to super_admin, admin and CFO.** That asymmetry is deliberate and is
 * enforced by the server: the people who may read a card are three, the person
 * who may change the lock for everybody is one.
 *
 * **Changing it does not re-encrypt anything.** The numbers are sealed with the
 * app's own key; this password gates the reading. So a change takes effect at
 * once, for everybody, and nothing already stored has to be rewritten.
 */
export function CardPasswordPanel() {
  const canWrite = useCan("settings.write");
  const toast = useToast();

  const [status, setStatus] = useState<CardPasswordStatus | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await accountsApi.cardPasswordStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function save() {
    setError(null);
    /*
     * Typed twice, and compared here.
     *
     * A password nobody can read back has no way to be checked afterwards: get
     * it wrong and every card in the company is unreadable until somebody sets
     * a new one, which means the numbers have to be typed in again. The second
     * box costs a moment and removes that entirely.
     */
    if (next !== again) {
      setError("The two new passwords are not the same.");
      return;
    }
    if (next.length < 8) {
      setError("Use at least eight characters — this one guards card numbers.");
      return;
    }

    setPending(true);
    try {
      const result = await accountsApi.setCardPassword({
        current: status?.isSet ? current : null,
        next,
      });
      setStatus(result);
      setCurrent("");
      setNext("");
      setAgain("");
      toast.show(
        status?.isSet ? "Card password changed." : "Card password set.",
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "That did not save.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Card password"
        description="One shared secret that unlocks the card numbers and CVCs on file"
      />
      <CardBody className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-lg bg-surface-muted px-4 py-3">
          {status?.isSet ? (
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-positive" />
          ) : (
            <ShieldOff className="mt-0.5 size-4 shrink-0 text-warning" />
          )}
          <div className="text-sm">
            {status?.isSet ? (
              <>
                <p>A card password is set.</p>
                {status.setAt ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Last changed {formatDate(status.setAt.slice(0, 10))}
                    {status.setBy ? ` by ${status.setBy}` : ""}
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <p>No card password is set.</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Until one is, a card&rsquo;s number and CVC cannot be read back
                  by anybody — including whoever typed them in.
                </p>
              </>
            )}
          </div>
        </div>

        {canWrite ? (
          <>
            {status?.isSet ? (
              <Field
                label="Current card password"
                required
                hint="Not your sign-in password"
              >
                <Input
                  type="password"
                  value={current}
                  onChange={(event) => setCurrent(event.target.value)}
                />
              </Field>
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="New card password" required>
                <Input
                  type="password"
                  value={next}
                  onChange={(event) => setNext(event.target.value)}
                />
              </Field>
              <Field
                label="Type it again"
                required
                hint="It cannot be read back, so it is checked here"
              >
                <Input
                  type="password"
                  value={again}
                  onChange={(event) => setAgain(event.target.value)}
                />
              </Field>
            </div>

            {error ? <p className="text-sm text-negative">{error}</p> : null}

            <div className="flex items-center justify-between gap-4">
              {/* What changes, and what does not — the question anybody about
                  to press this is actually asking. */}
              <p className="text-xs text-muted-foreground">
                Everyone who reads a card uses this same password, so a change
                takes effect at once for all of them. Nothing already stored is
                re-encrypted, and no card number has to be typed in again.
              </p>
              <Button
                type="button"
                variant="primary"
                disabled={pending || !next || !again || (status?.isSet && !current)}
                onClick={() => void save()}
              >
                {pending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <KeyRound className="size-4" />
                )}
                {status?.isSet ? "Change it" : "Set it"}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Only a super admin can set or change this. You can still use it to
            read a card, on the card&rsquo;s own page.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

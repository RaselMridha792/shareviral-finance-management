"use client";

import { Eye, LoaderCircle, Lock } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { Field, Input } from "@/components/ui/field";
import { ApiError } from "@/lib/api-client";
import { accountsApi, type AccountDto, type CardSecrets } from "@/lib/masters";

/**
 * What a card is, on the card's own page.
 *
 * The owner: *"card er khetre single page jekhane card details thake oikhane
 * card er details gula dekhano ucit oigula dekhacchena keno."* They were not
 * shown because nothing on the web ever called the endpoint that reads them —
 * the API has had `POST /accounts/:id/card-secrets` since the card fields were
 * added, and no screen used it.
 *
 * What is on the page WITHOUT asking anything: the holder, the label, the last
 * four digits and the expiry. Those are how one card is told from another, and
 * none of them is a secret — the last four are printed on every receipt.
 *
 * What needs the card password: the full number and the CVC. They are sealed in
 * the database and are not on the account DTO at all, at the type level, so
 * there is nothing to leak from a page that never asks.
 */
export function CardDetails({ account }: { account: AccountDto }) {
  const [revealing, setRevealing] = useState(false);
  /**
   * Held only while the drawer is open, and dropped the moment it closes.
   *
   * Not in a parent's state, not in a ref that outlives the panel, never in
   * `localStorage`. A card number that survives the drawer is a card number
   * sitting in a tab somebody walks away from.
   */
  const [secrets, setSecrets] = useState<CardSecrets | null>(null);

  const rows: Array<[string, string | null]> = [
    ["Card holder", account.cardHolderName],
    ["Card name", account.cardLabel],
    ["Card number", account.cardLast4 ? `•••• •••• •••• ${account.cardLast4}` : null],
    ["Expires", account.cardExpiry],
    ["CVC", account.cardSecretsSetAt ? "•••" : null],
  ];

  return (
    <Card>
      <CardHeader
        title="Card"
        description="What is printed on it"
        action={
          account.cardSecretsSetAt ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSecrets(null);
                setRevealing(true);
              }}
            >
              <Eye className="size-3.5" />
              Show the number
            </Button>
          ) : null
        }
      />
      <CardBody>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-4">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className={value ? "num text-sm" : "text-sm text-muted-foreground"}>
                {value ?? "N/A"}
              </dd>
            </div>
          ))}
        </dl>

        {!account.cardSecretsSetAt ? (
          <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            {/* Said plainly rather than left as an empty row: a card with no
                number on file is a card somebody meant to finish adding. */}
            No number or CVC is on file for this card. Add them by editing the
            account.
          </p>
        ) : null}
      </CardBody>

      {revealing ? (
        <RevealDrawer
          accountId={account.id}
          secrets={secrets}
          onRevealed={setSecrets}
          onClose={() => {
            setSecrets(null);
            setRevealing(false);
          }}
        />
      ) : null}
    </Card>
  );
}

function RevealDrawer({
  accountId,
  secrets,
  onRevealed,
  onClose,
}: {
  accountId: string;
  secrets: CardSecrets | null;
  onRevealed: (value: CardSecrets) => void;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reveal() {
    setPending(true);
    setError(null);
    try {
      onRevealed(await accountsApi.revealCard(accountId, password));
      /* The password itself is dropped the moment it has been used. */
      setPassword("");
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "That did not go through.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Show the card"
      description="The card password, not your sign-in password. Every reveal is recorded."
    >
      {secrets ? (
        <div className="flex flex-col gap-4">
          <Field label="Card number">
            <p className="num rounded-lg border border-border px-3 py-2 text-base tracking-wider">
              {secrets.cardNumber ?? "Not on file"}
            </p>
          </Field>
          <Field label="CVC">
            <p className="num rounded-lg border border-border px-3 py-2 text-base tracking-wider">
              {secrets.cardCvc ?? "Not on file"}
            </p>
          </Field>
          {/* The one sentence that makes the whole gate worth having. */}
          <p className="text-xs text-muted-foreground">
            This closes with the drawer and is not kept anywhere in the browser.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field
            label="Card password"
            required
            hint="Set by the super admin in Settings → Security"
          >
            <Input
              type="password"
              value={password}
              autoFocus
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && password) void reveal();
              }}
            />
          </Field>
          {error ? <p className="text-sm text-negative">{error}</p> : null}
        </div>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          {secrets ? "Done" : "Cancel"}
        </Button>
        {secrets ? null : (
          <Button
            type="button"
            variant="primary"
            disabled={pending || !password}
            onClick={() => void reveal()}
          >
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
            Show it
          </Button>
        )}
      </div>
    </Drawer>
  );
}

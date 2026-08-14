"use client";

import {
  AI_DATA_ACCESS,
  AI_DATA_ACCESS_DETAIL,
  AI_DATA_ACCESS_LABELS,
  AI_MODELS,
  AI_MODEL_DETAIL,
  AI_MODEL_LABELS,
  type AiAvailability,
  type AiDataAccess,
  type AiModel,
} from "@finance/shared";
import {
  CircleAlert,
  CircleCheck,
  ExternalLink,
  Eye,
  EyeOff,
  LoaderCircle,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ApiError } from "@/lib/api-client";
import { aiApi } from "@/lib/ai";

/**
 * Switching the assistant on, without a redeploy.
 *
 * The key goes one way — in. Nothing this screen receives from the API ever
 * contains it; when one is stored, all that comes back is the last four
 * characters, enough to tell which key it is and useless to anybody else.
 */
export function AssistantPanel() {
  const router = useRouter();
  const [status, setStatus] = useState<AiAvailability | null>(null);
  const [key, setKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const model: AiModel = status?.model ?? "claude-opus-5";
  const access: AiDataAccess =
    status?.dataAccess && status.dataAccess !== "off"
      ? status.dataAccess
      : "full";

  async function changeSettings(input: {
    model?: AiModel;
    dataAccess?: AiDataAccess;
  }) {
    setSaving(true);
    setError(null);
    try {
      setStatus(await aiApi.updateSettings(input));
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not change that setting.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function load() {
    try {
      setStatus(await aiApi.availability());
    } catch {
      setStatus(null);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);

    try {
      const result = await aiApi.setKey(key.trim());
      if (!result.saved) {
        // Anthropic refused it, so it was not stored. A key that does not work
        // is worse than none: the screen would say the assistant is on and
        // every message would fail.
        setError(result.message ?? "That key was not accepted.");
        return;
      }
      setKey("");
      setSaved(true);
      await load();
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not save that key.",
      );
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    setPending(true);
    setError(null);
    try {
      await aiApi.clearKey();
      setSaved(false);
      await load();
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not remove it.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        The assistant lets somebody describe an entry in Bangla or English and
        fills in the form for them. It is optional: everything it does can be
        done by typing, and the app works completely without it.
      </p>

      <Card>
        <CardHeader
          title="Anthropic API key"
          description="Needed for the assistant, and nothing else."
          action={
            status?.configured ? (
              <Badge tone="positive">
                <CircleCheck className="size-3" />
                Switched on
              </Badge>
            ) : (
              <Badge tone="neutral">Off</Badge>
            )
          }
        />
        <CardBody className="flex flex-col gap-4">
          {status?.configured ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-muted px-4 py-3">
              <div>
                <p className="num text-sm font-medium">{status.keyHint}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {status.fromEnvironment
                    ? "Set on the server as an environment variable, not here."
                    : `Set${status.setBy ? ` by ${status.setBy}` : ""}${
                        status.setAt ? ` on ${status.setAt.slice(0, 10)}` : ""
                      }.`}
                </p>
              </div>
              {status.fromEnvironment ? null : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={pending}
                  onClick={remove}
                >
                  <Trash2 className="size-3.5" />
                  Remove
                </Button>
              )}
            </div>
          ) : null}

          <form onSubmit={save} className="flex flex-col gap-4">
            <Field
              label={status?.configured ? "Replace it" : "Paste the key"}
              hint={
                <>
                  Starts with <code>sk-ant-</code>. It is checked against
                  Anthropic before it is saved, encrypted before it is stored,
                  and never sent back to a browser.
                </>
              }
            >
              <div className="flex gap-2">
                <Input
                  name="apiKey"
                  type={visible ? "text" : "password"}
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  placeholder="sk-ant-..."
                  autoComplete="off"
                  spellCheck={false}
                  className="num"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setVisible(!visible)}
                  aria-label={visible ? "Hide the key" : "Show the key"}
                >
                  {visible ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </Button>
              </div>
            </Field>

            {error ? (
              <p
                role="alert"
                className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
              >
                {error}
              </p>
            ) : null}

            {saved ? (
              <p className="rounded-lg bg-positive/10 px-3 py-2 text-sm text-positive">
                Saved and working. The Assistant screen is available now.
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                variant="primary"
                disabled={pending || key.trim().length < 20}
              >
                {pending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {status?.configured ? "Replace the key" : "Switch it on"}
              </Button>

              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                Get a key
                <ExternalLink className="size-3.5" />
              </a>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="What leaves the building"
          description="Anything the assistant is given is sent to Anthropic to be turned into a sentence. This decides how much that is."
        />
        <CardBody className="flex flex-col gap-4">
          <Field label="How much it may read" hint={AI_DATA_ACCESS_DETAIL[access]}>
            <Select
              value={access}
              disabled={saving}
              onChange={(event) =>
                void changeSettings({
                  dataAccess: event.target.value as AiDataAccess,
                })
              }
            >
              {AI_DATA_ACCESS.filter((option) => option !== "off").map(
                (option) => (
                  <option key={option} value={option}>
                    {AI_DATA_ACCESS_LABELS[option]}
                  </option>
                ),
              )}
            </Select>
          </Field>

          {access === "full" ? (
            <div className="flex items-start gap-3 rounded-lg bg-warning/10 px-4 py-3">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
              <p className="text-sm text-muted-foreground">
                Real figures from your books will be sent to Anthropic when
                somebody asks a question. Each lookup still runs as the person
                asking, so nobody sees more through the assistant than they
                would by clicking — and pay is unreachable either way.
              </p>
            </div>
          ) : null}

          <Field label="Which model answers" hint={AI_MODEL_DETAIL[model]}>
            {AI_MODELS.length > 1 ? (
              <Select
                value={model}
                disabled={saving}
                onChange={(event) =>
                  void changeSettings({ model: event.target.value as AiModel })
                }
              >
                {AI_MODELS.map((option) => (
                  <option key={option} value={option}>
                    {AI_MODEL_LABELS[option]}
                  </option>
                ))}
              </Select>
            ) : (
              <p className="text-sm font-medium">{AI_MODEL_LABELS[model]}</p>
            )}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="What it cannot do, whatever the setting" />
        <CardBody>
          <ul className="flex max-w-2xl flex-col gap-2 text-sm text-muted-foreground">
            <li>
              <strong>Save anything.</strong> It has no write tool of any kind.
              Every draft becomes an ordinary form that a person presses Save
              on, going through the same endpoint, permission check and audit
              row as typing it would.
            </li>
            <li>
              <strong>Reach anybody&apos;s pay.</strong> Compensation lives in a
              table no lookup touches, and it is told never to ask.
            </li>
            <li>
              <strong>See more than the person asking.</strong> Every lookup is
              checked against their own permissions, so HR gets the same refusal
              here as on a screen.
            </li>
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

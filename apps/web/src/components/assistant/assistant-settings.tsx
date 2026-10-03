"use client";

import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr/ArrowSquareOut";
import { CpuIcon } from "@phosphor-icons/react/dist/ssr/Cpu";
import { GearSixIcon } from "@phosphor-icons/react/dist/ssr/GearSix";
import { KeyIcon } from "@phosphor-icons/react/dist/ssr/Key";
import { ProhibitIcon } from "@phosphor-icons/react/dist/ssr/Prohibit";
import {
  AI_DATA_ACCESS,
  AI_DATA_ACCESS_DETAIL,
  AI_DATA_ACCESS_LABELS,
  AI_MODELS,
  AI_MODEL_DETAIL,
  AI_MODEL_LABELS,
  AI_PROVIDERS,
  AI_PROVIDER_DETAIL,
  AI_PROVIDER_LABELS,
  aiRouteFor,
  isGeminiModel,
  type AiAvailability,
  type AiDataAccess,
  type AiModel,
  type AiProvider,
} from "@finance/shared";
import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  ExternalLink,
  Eye,
  EyeOff,
  LoaderCircle,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import { AssistantInstructions } from "@/components/assistant/assistant-instructions";
import { AssistantMistakes } from "@/components/assistant/assistant-mistakes";
import { GoogleConnection } from "@/components/assistant/google-connection";
import { UsageReportCard } from "@/components/assistant/usage-report";
import { useCan } from "@/components/auth/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { ApiError } from "@/lib/api-client";
import { aiApi } from "@/lib/ai";

/**
 * The Assistant's own settings (B2, 3 Oct 2026): behind the gear on the chat
 * and in its window, the way ChatGPT and Claude keep theirs, rather than two
 * sections of the app's Settings. `/settings?tab=assistant` and
 * `?tab=connections` open this page.
 *
 * The Super Admin changes everything here, as before. The CFO reads it and
 * changes nothing (the owner, 3 Oct): the default model, the way Claude is
 * reached, how much it may read, the instructions and the recent mistakes —
 * never a key, a key's hint, or the Google address. The API sends the CFO no
 * hint at all (#150), and the Google Cloud card is not drawn for them.
 *
 * Under /assistant, which is a full-window room (main-region.tsx), so the
 * page brings its own scroll and padding, as What the Assistant knows does.
 */
export function AssistantSettingsScreen({
  initial,
}: {
  initial: AiAvailability;
}) {
  const canConfigure = useCan("settings.write");
  const router = useRouter();
  const [status, setStatus] = useState<AiAvailability>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** How many rules have been made from mistakes on this visit. */
  const [rulesAdded, setRulesAdded] = useState(0);

  const model: AiModel = status.model ?? AI_MODELS[0];
  const claudeRoute: AiProvider = status.provider ?? "anthropic";
  const route = aiRouteFor(model, claudeRoute);
  const open = status.models ?? [];
  const access: AiDataAccess =
    status.dataAccess && status.dataAccess !== "off"
      ? status.dataAccess
      : "full";
  /** Where a question's data goes with the default, named for the warning. */
  const destination =
    route === "vertex"
      ? `Google Cloud (${isGeminiModel(model) ? "Gemini" : "Claude"} on Vertex AI)`
      : "Anthropic";

  async function load() {
    try {
      setStatus(await aiApi.availability());
    } catch {
      // The page keeps what it had; the next change reads it again.
    }
  }

  async function change(input: {
    model?: AiModel;
    dataAccess?: AiDataAccess;
    provider?: AiProvider;
  }) {
    setSaving(true);
    setError(null);
    try {
      setStatus(await aiApi.updateSettings(input));
      router.refresh();
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

  return (
    <div className="h-[calc(100dvh-4rem)] overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-[18px] p-[clamp(16px,2vw,24px)]">
        <PageHeader
          eyebrow="AI Assistant"
          title="Assistant settings"
          icon={GearSixIcon}
          description="Which model answers, how it is reached, how much of the books it may read, and the rules it is given. The Assistant is optional: everything it does can be done on the ordinary forms."
          actions={
            <Link
              href="/assistant"
              className="inline-flex h-11 items-center gap-2 rounded-lg px-4 text-[14px] font-extrabold text-(--sv-violet-ink) transition-colors hover:text-(--sv-ink)"
            >
              <ArrowLeftIcon weight="bold" size={16} />
              Back to the chat
            </Link>
          }
        />

        {canConfigure ? null : (
          <p className="rounded-lg bg-surface-muted px-4 py-3 text-sm text-muted-foreground">
            You can read these settings. Only a Super Admin can change them. The
            model answering a conversation you can pick yourself, in the chat.
          </p>
        )}

        <div className="grid items-start gap-[18px] xl:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-[18px]">
            <Card>
              <CardHeader
                title="Model"
                icon={CpuIcon}
                description="What a new chat starts with. In the chat, anybody who may use the Assistant can pick another model for that conversation, and it keeps it."
              />
              <CardBody className="flex flex-col gap-4">
                {canConfigure ? (
                  <>
                    <Field
                      label="New chats start with"
                      hint={AI_MODEL_DETAIL[model]}
                    >
                      <Select
                        value={model}
                        disabled={saving}
                        onChange={(event) =>
                          void change({
                            model: event.target.value as AiModel,
                          })
                        }
                      >
                        {AI_MODELS.map((option) => {
                          // Gemini goes through Google Cloud and no other
                          // way; the API refuses it with no Google key too.
                          const stranded =
                            isGeminiModel(option) && !status.googleKeySet;
                          return (
                            <option
                              key={option}
                              value={option}
                              disabled={stranded}
                            >
                              {AI_MODEL_LABELS[option]}
                              {stranded
                                ? " — add the Google Cloud key first"
                                : ""}
                            </option>
                          );
                        })}
                      </Select>
                    </Field>

                    <Field
                      label="Claude goes through"
                      hint={AI_PROVIDER_DETAIL[claudeRoute]}
                    >
                      <Select
                        value={claudeRoute}
                        disabled={saving}
                        onChange={(event) =>
                          void change({
                            provider: event.target.value as AiProvider,
                          })
                        }
                      >
                        {AI_PROVIDERS.map((option) => (
                          <option
                            key={option}
                            value={option}
                            // Google Cloud with no Google key would leave
                            // Claude with no way at all; the API refuses it.
                            disabled={
                              option === "vertex" && !status.googleKeySet
                            }
                          >
                            {AI_PROVIDER_LABELS[option]}
                            {option === "vertex" && !status.googleKeySet
                              ? " — add the Google Cloud key first"
                              : ""}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </>
                ) : (
                  <dl className="grid gap-x-4 gap-y-3 text-[14px] sm:grid-cols-[180px_1fr]">
                    <Fact label="New chats start with">
                      {AI_MODEL_LABELS[model]}
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {AI_MODEL_DETAIL[model]}
                      </span>
                    </Fact>
                    <Fact label="Claude goes through">
                      {AI_PROVIDER_LABELS[claudeRoute]}
                    </Fact>
                  </dl>
                )}

                <div className="rounded-lg bg-surface-muted px-4 py-3 text-sm">
                  <p className="font-semibold">In the chat&apos;s picker now</p>
                  <p className="mt-0.5 text-muted-foreground">
                    {open.length
                      ? open.map((one) => AI_MODEL_LABELS[one]).join(", ")
                      : "None yet: no model can be reached until a key is added."}
                    {open.length && !status.googleKeySet
                      ? ". Gemini joins them once the Google Cloud key is added."
                      : open.length
                        ? "."
                        : ""}
                  </p>
                </div>

                {status.configured ? null : (
                  <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm">
                    <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                    <span>{status.reason}</span>
                  </p>
                )}

                {error ? (
                  <p
                    role="alert"
                    className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
                  >
                    {error}
                  </p>
                ) : null}
              </CardBody>
            </Card>

            {/* Shown only while Claude goes this way (B2): a key box for a
                route nobody uses is a question nobody needs to answer. */}
            {canConfigure && claudeRoute === "anthropic" ? (
              <AnthropicKey status={status} onChanged={load} />
            ) : null}

            {canConfigure ? <GoogleConnection onChanged={load} /> : null}

            <Card>
              <CardHeader
                title="What leaves the building"
                icon={ArrowSquareOutIcon}
                description={`Anything the Assistant is given is sent to the model's maker to be turned into a sentence — with the default, ${destination}. This decides how much that is.`}
              />
              <CardBody className="flex flex-col gap-4">
                {canConfigure ? (
                  <Field
                    label="How much it may read"
                    hint={AI_DATA_ACCESS_DETAIL[access]}
                  >
                    <Select
                      value={access}
                      disabled={saving}
                      onChange={(event) =>
                        void change({
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
                ) : (
                  <dl className="grid gap-x-4 gap-y-3 text-[14px] sm:grid-cols-[180px_1fr]">
                    <Fact label="How much it may read">
                      {AI_DATA_ACCESS_LABELS[access]}
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {AI_DATA_ACCESS_DETAIL[access]}
                      </span>
                    </Fact>
                  </dl>
                )}

                {access === "full" ? (
                  <div className="flex items-start gap-3 rounded-lg bg-warning/10 px-4 py-3">
                    <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                    <p className="text-sm text-muted-foreground">
                      Real figures from your books are sent to the model&apos;s
                      maker when somebody asks a question. Each lookup still
                      runs as the person asking, so nobody sees more through the
                      Assistant than they would by clicking — and pay is
                      unreachable either way.
                    </p>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          </div>

          <div className="flex min-w-0 flex-col gap-[18px]">
            {/* Remounted when a mistake is made a rule, so the box reads the
                instructions with the new line in them rather than saving
                over it. */}
            <AssistantInstructions key={rulesAdded} readOnly={!canConfigure} />

            <AssistantMistakes
              readOnly={!canConfigure}
              onRuled={() => setRulesAdded((n) => n + 1)}
            />

            <Link
              href="/assistant/knowledge"
              className="inline-flex w-fit items-center gap-1.5 text-[13.5px] font-extrabold text-(--sv-violet-ink) transition-colors hover:text-(--sv-ink)"
            >
              What the Assistant knows: the map of the app it is given
              <ArrowRight className="size-4" />
            </Link>

            <Card>
              <CardHeader
                title="What it cannot do, whatever the setting"
                icon={ProhibitIcon}
              />
              <CardBody>
                <ul className="flex max-w-2xl flex-col gap-2 text-sm text-muted-foreground">
                  <li>
                    <strong>Save anything by itself.</strong> A draft is saved
                    when a person presses Confirm and save on its card, through
                    the same endpoint, permission check and audit row as the
                    record&apos;s own form.
                  </li>
                  <li>
                    <strong>Reach anybody&apos;s pay.</strong> Compensation
                    lives in a table no lookup touches, and it is told never to
                    ask.
                  </li>
                  <li>
                    <strong>See more than the person asking.</strong> Every
                    lookup is checked against their own permissions, so a role
                    gets the same refusal here as on a screen.
                  </li>
                </ul>
              </CardBody>
            </Card>
          </div>
        </div>

        {/* What it spends (B3): the report, and the Super Admin's limit. */}
        <UsageReportCard canConfigure={canConfigure} />
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-semibold wrap-break-word">{children}</dd>
    </>
  );
}

/**
 * The Anthropic key: the Super Admin's alone, and drawn only while Claude
 * goes this way.
 *
 * The key goes one way — in. Nothing this screen receives from the API ever
 * contains it; when one is stored, all that comes back is the last four
 * characters, enough to tell which key it is and useless to anybody else.
 */
function AnthropicKey({
  status,
  onChanged,
}: {
  status: AiAvailability;
  onChanged: () => Promise<void>;
}) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
      await onChanged();
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not save that key.",
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
      await onChanged();
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
    <Card>
      <CardHeader
        title="Anthropic API key"
        icon={KeyIcon}
        description="How Claude is reached while it goes through the Anthropic key, and nothing else."
        action={
          status.keyHint ? (
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
        {status.keyHint ? (
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
                onClick={() => void remove()}
              >
                <Trash2 className="size-3.5" />
                Remove
              </Button>
            )}
          </div>
        ) : null}

        <form onSubmit={save} className="flex flex-col gap-4">
          <Field
            label={status.keyHint ? "Replace it" : "Paste the key"}
            hint={
              <>
                Starts with <code>sk-ant-</code>. It is checked against
                Anthropic before it is saved, encrypted before it is stored, and
                never sent back to a browser.
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
              Saved and working. Claude answers in the chat now.
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
              {status.keyHint ? "Replace the key" : "Switch it on"}
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
  );
}

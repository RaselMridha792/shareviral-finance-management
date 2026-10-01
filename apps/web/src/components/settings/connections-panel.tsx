"use client";

import { GoogleLogoIcon } from "@phosphor-icons/react/dist/ssr/GoogleLogo";
import { ListNumbersIcon } from "@phosphor-icons/react/dist/ssr/ListNumbers";
import type { GoogleCheck, GoogleConnection } from "@finance/shared";
import {
  CircleAlert,
  CircleCheck,
  Copy,
  ExternalLink,
  FileUp,
  LoaderCircle,
  PlugZap,
  Stethoscope,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/overlay";
import { ApiError } from "@/lib/api-client";
import { connectionsApi } from "@/lib/connections";

/**
 * Settings → Connections: the Google Cloud service account (#131).
 *
 * One key for two jobs — Claude or Gemini through Vertex AI, when the
 * Assistant is set to go that way, and reading the Sheets and Docs shared
 * with the account.
 * The key goes one way, in: what comes back is the client email, which is the
 * address files are shared with, and the project.
 */
export function ConnectionsPanel() {
  const router = useRouter();
  const [google, setGoogle] = useState<GoogleConnection | null>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [testing, setTesting] = useState(false);
  const [checks, setChecks] = useState<GoogleCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    connectionsApi
      .google()
      .then(setGoogle)
      .catch(() => setGoogle(null));
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);
    setChecks(null);

    try {
      const result = await connectionsApi.setGoogleKey(text.trim());
      setGoogle(result.connection);
      if (!result.saved) {
        // Not stored: a key Google will not accept is worse than none.
        setError(result.message ?? "That key was not accepted.");
        return;
      }
      setText("");
      setSaved(true);
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
    setSaved(false);
    setChecks(null);
    try {
      setGoogle(await connectionsApi.clearGoogleKey());
      setConfirming(false);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not remove it.",
      );
    } finally {
      setPending(false);
    }
  }

  async function test() {
    setTesting(true);
    setError(null);
    setChecks(null);
    try {
      setChecks((await connectionsApi.testGoogle()).checks);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not run the test.",
      );
    } finally {
      setTesting(false);
    }
  }

  /** The downloaded file, read here and sent as text — never uploaded whole. */
  async function choose(chosen: File | undefined) {
    if (!chosen) return;
    setText(await chosen.text());
    if (file.current) file.current.value = "";
  }

  async function copy(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Selecting the address by hand still works.
    }
  }

  const configured = Boolean(google?.configured);

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        A Google Cloud service account does two things here: it reaches the
        Assistant&apos;s model, Claude or Gemini, through Vertex AI, when the
        Assistant is set to go that way, and it reads the Google Sheets and Docs
        you share with it. It can only read what was shared, and it cannot
        change anything.
      </p>

      <Card>
        <CardHeader
          title="Google Cloud"
          icon={GoogleLogoIcon}
          description="One service-account key, for the Assistant's model and for shared files."
          action={
            configured ? (
              <Badge tone="positive">
                <CircleCheck className="size-3" />
                Connected
              </Badge>
            ) : (
              <Badge tone="neutral">Off</Badge>
            )
          }
        />
        <CardBody className="flex flex-col gap-4">
          {configured && google ? (
            <div className="flex flex-col gap-3 rounded-lg bg-surface-muted px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">
                    Share files with this address, as Viewer
                  </p>
                  <p className="num mt-0.5 text-sm font-medium break-all">
                    {google.clientEmail}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Project <span className="num">{google.projectId}</span> ·
                    The model asked in{" "}
                    <span className="num">{google.region}</span>
                    {google.setBy || google.setAt
                      ? ` · Set${google.setBy ? ` by ${google.setBy}` : ""}${
                          google.setAt ? ` on ${google.setAt.slice(0, 10)}` : ""
                        }`
                      : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void copy(google.clientEmail ?? "")}
                  >
                    <Copy className="size-3.5" />
                    {copied ? "Copied" : "Copy address"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={pending || testing}
                    onClick={() => void test()}
                  >
                    {testing ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <Stethoscope className="size-3.5" />
                    )}
                    Test
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={pending || testing}
                    onClick={() => setConfirming(true)}
                  >
                    <Trash2 className="size-3.5" />
                    Remove
                  </Button>
                </div>
              </div>

              {checks ? (
                <ul className="flex flex-col gap-2 border-t border-(--sv-line) pt-3">
                  {checks.map((check) => (
                    <li key={check.id} className="flex items-start gap-2.5">
                      {check.ok ? (
                        <CircleCheck className="mt-0.5 size-4 shrink-0 text-positive" />
                      ) : (
                        <CircleAlert className="mt-0.5 size-4 shrink-0 text-negative" />
                      )}
                      <p className="text-sm">
                        <strong>{check.label}.</strong>{" "}
                        <span className="text-muted-foreground">
                          {check.message}
                        </span>
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <form onSubmit={save} className="flex flex-col gap-4">
            <Field
              label={configured ? "Replace it" : "Paste the JSON key"}
              hint={
                <>
                  The whole file Google downloads, from the first{" "}
                  <code>{"{"}</code> to the last <code>{"}"}</code>. It is
                  checked with Google before it is saved, encrypted before it is
                  stored, and never sent back to a browser.
                </>
              }
            >
              <Textarea
                name="serviceAccount"
                rows={6}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder='{ "type": "service_account", "project_id": "...", ... }'
                autoComplete="off"
                spellCheck={false}
                className="num text-[12.5px]"
              />
            </Field>

            <input
              ref={file}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => void choose(event.target.files?.[0])}
            />

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
                Saved — Google accepted the key. Press Test to see which parts
                are ready.
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                variant="primary"
                disabled={pending || text.trim().length < 2}
              >
                {pending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <PlugZap className="size-4" />
                )}
                {configured ? "Replace the key" : "Connect"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => file.current?.click()}
              >
                <FileUp className="size-4" />
                Choose the .json file
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={confirming}
        title="Remove the Google Cloud key?"
        destructive
        confirmLabel="Remove"
        pending={pending}
        body="Shared Sheets and Docs can no longer be read. If the Assistant goes through Google Cloud, it goes back to the Anthropic key, and to Claude."
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(false)}
      />

      <Card>
        <CardHeader
          title="Setting it up in Google Cloud"
          icon={ListNumbersIcon}
          description="Once, in the console. The key is the only thing that comes here."
        />
        <CardBody>
          <ol className="flex max-w-2xl list-decimal flex-col gap-2 pl-5 text-sm text-muted-foreground">
            <li>
              <strong>Create a project</strong> and attach billing to it.
            </li>
            <li>
              <strong>Enable the APIs:</strong> Vertex AI, Google Sheets, Google
              Docs and Google Drive.
            </li>
            <li>
              <strong>Enable the model.</strong> In Vertex AI → Model Garden,
              find Claude Opus 5 and enable it, accepting the terms. Gemini
              needs no enabling.
            </li>
            <li>
              <strong>Create a service account</strong> under IAM → Service
              accounts, with the role &ldquo;Vertex AI User&rdquo;.
            </li>
            <li>
              <strong>Make its key:</strong> Keys → Add key → JSON. Paste that
              file above. If Google will not make a key, the organisation policy
              &ldquo;Disable service account key creation&rdquo; is on for the
              project and has to be relaxed.
            </li>
            <li>
              <strong>Share files</strong> with the address shown above once the
              key is saved, as Viewer. The app sees nothing that was not shared
              with it.
            </li>
          </ol>
          <a
            href="https://console.cloud.google.com/"
            target="_blank"
            rel="noreferrer noopener"
            className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Open the Google Cloud console
            <ExternalLink className="size-3.5" />
          </a>
        </CardBody>
      </Card>
    </div>
  );
}

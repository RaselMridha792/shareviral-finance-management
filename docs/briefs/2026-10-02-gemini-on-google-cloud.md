# Brief — Gemini through the Google Cloud connection

**For:** the next Claude session in this repository.
**From:** the session that wrote the Google connections brief, 2 Oct 2026, after the owner
decided. Read `docs/briefs/2026-10-01-google-connections.md` and SESSIONS #130–#131 first.

## Where things stand

- **Settings → Connections works** (#131). The service-account key is saved and Google
  accepted it. Sheets, Docs and Drive read; nothing has been shared with the account yet.
- **Claude on Vertex is blocked by Google, not by our code.**
  - The project `shareviral-finance` has a quota of **0** for Anthropic Claude Opus 5.
  - The console refuses an increase: "not eligible … based on your service usage history".
  - Agent Studio says the same ("You've reached your project's quota for Anthropic Claude
    Opus 5").
  - The owner has been told to ask Google Sales, and to retry Anthropic's own
    verification with a passport. Either may take days.
- **Gemini works on the same project today.** The owner sent "hi" to `gemini-2.5-pro` in
  Agent Studio on 2 Oct and it answered. No quota request was needed.
- **The owner's decision (2 Oct):** run the Assistant on Gemini through the Google Cloud
  connection that already exists.
  - No separate Gemini API key.
  - **Why not an AI Studio key:** a free-tier key may let Google use the data to improve
    its products, which is not acceptable for the books. An API key also cannot read the
    privately shared Sheets/Docs the owner wants the Assistant to read.

## The quality bar — read this before anything else

`packages/shared/src/ai.ts` explains why only `claude-opus-5` is offered: *"On the same
test conversations the cheaper ones invented an account nobody had named; this one asked
instead."* A guessed account files real money in the wrong place, and the entry looks
ordinary afterwards.

**Gemini goes into the picker only if it clears the same bar.** Build a small fixed set of
test conversations and run it on both models: Claude when it becomes reachable, Gemini now.
At least:
- a request that names no account where one is needed: it must ask, never pick one;
- a vendor or category that does not exist: it must ask, or say so;
- an Excel attachment of mixed rows: drafts land in the right kinds, with exact figures;
- a PDF bank statement (`pdf-statement.ts`);
- a question that needs two or three look-ups before answering.

Record the results in SESSIONS. If Gemini invents, it is not offered, and the owner is told
plainly, with the examples.

## The design

- **No schema change.**
  - `app_settings.ai_provider` stays `'anthropic' | 'vertex'`, where `vertex` means
    "through Google Cloud".
  - `ai_model` is plain `text` with no database check. The model decides Claude or Gemini:
    add the Gemini model to `AI_MODELS` in `packages/shared/src/ai.ts`, with its labels and
    detail.
  - `packages/shared` is shared code. Its users are the composer, `assistant-panel.tsx`,
    `ai-intake.service.ts` and `connections.service.ts`. Say so in the handover; then
    `npm run build:shared`.
- **Which models go with which provider:**
  - A Gemini model only goes with `vertex`, and a Claude model with either provider.
  - Refuse an impossible pair in `updateAiSettingsSchema` / the service, with words, not a
    500.
- **SDK.** Use Google's Gen AI SDK (`@google/genai`) in Vertex mode: the project and
  location from the stored key, and credentials from the sealed service-account JSON
  (`openServiceAccount`). **Check the constructor and the call shapes against the
  package's own README before writing them; do not guess.** Watch the Windows
  `package-lock.json` churn: the diff must be additions only.
- **One turn interface, two adapters.** Everything that is about the books stays shared:
  the prompts, the tool definitions, `normalise`, the corrections and the attachments.
  Only "send this turn, get tool calls or an answer" differs.
  - **System prompt.** Claude takes `system`; Gemini takes `config.systemInstruction`.
  - **Tools.** Claude takes `tools` with `input_schema`; Gemini takes `functionDeclarations`
    with a JSON-schema parameters field. Keep the schemas as they are, and convert them.
  - **Forcing a tool.** Today it is `tool_choice: any`, then `{tool: "answer"}` on the
    last round. Gemini's equivalent is `toolConfig.functionCallingConfig` mode `ANY` with
    `allowedFunctionNames: ["answer"]` on the last round.
  - **The loop.** Claude returns `tool_use` and takes `tool_result` back. Gemini uses
    `functionCall` / `functionResponse` parts, with roles `user` / `model`.
  - **PDF.** Claude takes a `document` block; Gemini takes `inlineData` with
    `application/pdf`.
  - **Prompt caching.** Claude has `cache_control`; for Gemini, leave it out (Google
    caches implicitly).
  - **Errors.** Claude's go through `claude-errors.ts`. Gemini needs the same kind of
    plain sentences:
    - 429 means quota;
    - 403 or 404 means the model is not enabled, or the role is missing;
    - 400 means a bad request.

    Log the raw error, with the secret cut out, **every time**. The Vertex check in
    `connections.service.ts` only logs errors it could not explain, and that cost the
    owner an evening (2 Oct).
- **Settings and the Connections Test.**
  - Settings → Assistant offers the Gemini model when the provider is Google Cloud.
  - Connections → Test gains a "Gemini on Vertex AI" line: one tiny request.
  - Remember that Gemini thinks by default: `max_tokens: 1`-style checks must leave it room
    to answer.
- **Spend.** Gemini is billed per token through the same billing account. Real test runs
  cost a little; keep them small, and say so in the handover.

## Order

1. **The adapter and the test set, running locally against real Vertex.** The local
   `apps/api/.env` has no Google key. Use the stored one through the app's own Test, or ask
   the owner to paste the key into the local Settings. Never into chat.
2. **The Settings choice and the Connections line.**
3. **The quality results, written down.** The owner decides from them whether Gemini goes
   live.

Step 3 of the earlier brief (reading Sheets/Docs from a link) still follows after this.

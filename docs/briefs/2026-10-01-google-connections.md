# Brief — Google Cloud connections: Claude through Vertex AI, and Google Sheets/Docs

**For:** the next Claude session in this repository.
**From:** the session that wrote #128/#129, 1 Oct 2026, after the owner decided.

## What the owner wants, and why

- **Why the Assistant is stuck.** Anthropic wants the account's identity
  verified before it will answer, and the owner's NID does not get through.
  The app already turns that refusal into words (`ai-intake.service.ts`,
  `turn()`: "Anthropic needs the account verified…"). Until it is solved the
  Assistant is useless.
- **What the Assistant is for.** The owner has a lot of badly organised data in
  Excel. They want the Assistant to read it, work out where each row belongs,
  and draft the records, which they then check by hand. Most of that already
  exists:
  - The Assistant reads an uploaded .xlsx or .csv (`ai-attachments.service.ts`:
    `read_attachment`, `group_attachment`).
  - It drafts records, and nothing reaches the books until a person presses
    Save.
- **The owner's two decisions** (AskUserQuestion, 1 Oct):
  1. **Claude through Google Cloud (Vertex AI)** instead of an Anthropic key.
     Billing and checks are Google's, and the Assistant stays the same.
  2. **Google Sheets and Docs through a service account.** The owner pastes one
     key into **Settings → Connections**, a new tab, then shares each file with
     the service account's email. The app reads only what was shared, and can
     never write.

One Google Cloud project and one service account serve both.

## Facts checked (claude-api skill, 1 Oct 2026)

- **Package and constructor.** `@anthropic-ai/vertex-sdk`:
  `new AnthropicVertex({ projectId, region, googleAuth })`. It returns the same
  `messages.create` surface as `new Anthropic()`.
- **Explicit credentials.**
  `googleAuth: new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform", ... })`
  from `google-auth-library`. The SDK's README shows `keyFile`; we hold the
  JSON in the database, so we pass `credentials: <parsed JSON>` instead. That
  is GoogleAuth's standard option; check it compiles.
- **Model ID on Vertex.** Current models use the bare ID, so the app's
  `claude-opus-5` stays `claude-opus-5`. Region `"global"` is recommended.
- **Features.** Vertex supports everything the Assistant uses: messages, tool
  use, PDF input, thinking and effort, prompt caching. It does NOT support the
  Files API, Batches, the Models API or server-side `fallbacks`; the Assistant
  uses none of them (grep confirmed: only `messages.create`).
- **Where the client is built: two places only.**
  - `AiIntakeService.anthropic()` (~line 566), currently
    `new Anthropic({ apiKey: key })`;
  - `setKey()`, which checks a key with a one-token request.

  `pdf-statement.ts` takes the client handed to it.

## The work, in order: one session, one push each

1. **Schema, alone** (`deploy/sql`, idempotent, own commit and push). Add to
   `app_settings`:
   - `ai_provider` (`'anthropic' | 'vertex'`, default `'anthropic'`);
   - `google_service_account` (sealed with `secret-box`, as
     `anthropic_api_key` is);
   - `google_key_set_at`, `google_key_set_by`;
   - `vertex_region` (default `'global'`).

   The project ID and the client email are read from the key's JSON, so they
   are not stored separately. Apply locally with `node .sql.mjs`.
2. **Settings → Connections and the Assistant on Vertex.**
   - **Settings → Connections** (new tab, Super Admin):
     - a "Google Cloud" card where the service-account JSON is pasted and
       validated (it must have `type: service_account`, `project_id`,
       `client_email` and `private_key`), then stored sealed and never shown
       again;
     - the card shows the client email ("share files with this address") and
       the project;
     - a Test button: one tiny Claude request on Vertex, and a Sheets API
       check;
     - Remove.
   - **Assistant settings:** "Reach Claude through: Anthropic key / Google
     Cloud".
   - **`anthropic()`** returns `AnthropicVertex` when the provider is
     `vertex`. Map Google's errors into the same plain sentences `turn()` gives
     for Anthropic's: permission denied → the model is not enabled in Model
     Garden, or the role is missing.
   - **New dependencies:** `@anthropic-ai/vertex-sdk` and
     `google-auth-library`.
     - Watch `package-lock.json`: npm on Windows deletes `libc` fields, so
       the diff must be additions only.
     - `@anthropic-ai/sdk` is ^0.116; check the vertex-sdk version that
       pairs with it.
   - **Never log the key.** Nothing about it goes into the audit log beyond
     "the Google key was set or removed by X".
3. **Google Sheets and Docs in the Assistant.**
   - Paste a Google Sheet or Doc link and the API reads it with the service
     account, using read-only scopes:
     - `spreadsheets.readonly`;
     - `documents.readonly`;
     - `drive.readonly` for exports.
   - A sheet goes through the same path as an uploaded spreadsheet
     (headers + rows → an attachment). A doc becomes text.
   - Not shared → "Share this file with <client email> first".
4. **Later, if the owner wants it: very large sheets.** The Assistant reads
   100 rows per look-up. For thousands of rows:
   - the model proposes a column-to-field mapping, plus the category or vendor
     for each distinct value;
   - code applies it to every row;
   - the owner reviews the drafts in bulk.

## What the owner sets up in Google Cloud (in the console, never in chat)

1. **Create a project** (e.g. `sfm-assistant`) at console.cloud.google.com,
   and attach billing.
2. **Enable the APIs:** Vertex AI, Google Sheets, Google Docs, Google Drive.
3. **Enable the model.** In Vertex AI → Model Garden, find Claude Opus 5 (the
   model the app uses) and enable it, accepting the terms.
4. **Create the service account.** In IAM → Service accounts, create one (e.g.
   `sfm-assistant`) with the role "Vertex AI User".
5. **Make its key.** Keys → Add key → JSON, which downloads a file. It is
   pasted into Settings → Connections once step 2 above is built. If Google
   refuses to create a key, an organisation policy
   (`iam.disableServiceAccountKeyCreation`) is blocking it, and it must be
   relaxed for this project.
6. **Share files.** Share each Sheet or Doc with the service account's email
   (`…@<project>.iam.gserviceaccount.com`) as Viewer.

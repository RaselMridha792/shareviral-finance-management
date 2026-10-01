-- Google Cloud for the Assistant: Claude through Vertex AI, and Google Sheets
-- and Docs read with a service account (docs/briefs/2026-10-01-google-connections.md).
--
-- The owner, 1 Oct 2026: Anthropic will not answer until the account's
-- identity is verified, and the owner's NID does not get through. So Claude is
-- reached through Google Cloud instead, and the same Google project's service
-- account reads the Sheets and Docs the owner shares with it.
--
-- Five columns on the settings row, all additive with defaults or nullable, so
-- the row that exists already means "the Anthropic key, as before":
--
--   ai_provider             'anthropic' or 'vertex' -- which way the Assistant
--                           reaches Claude. Anthropic until somebody chooses.
--   google_service_account  the service account's JSON key, sealed with
--                           secret-box exactly as anthropic_api_key is. The
--                           project id and the client email are read out of
--                           it, so neither is stored on its own.
--   google_key_set_at/_by   when, and by whom -- never what.
--   vertex_region           where Vertex is asked. 'global' is what Google
--                           recommends for Claude.
--
-- Defined here and nowhere else; the check rides inside ADD COLUMN IF NOT
-- EXISTS, so a second run changes nothing.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS ai_provider text NOT NULL DEFAULT 'anthropic'
    CONSTRAINT app_settings_ai_provider_check
      CHECK (ai_provider IN ('anthropic', 'vertex')),
  ADD COLUMN IF NOT EXISTS google_service_account text,
  ADD COLUMN IF NOT EXISTS google_key_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS google_key_set_by uuid,
  ADD COLUMN IF NOT EXISTS vertex_region text NOT NULL DEFAULT 'global';

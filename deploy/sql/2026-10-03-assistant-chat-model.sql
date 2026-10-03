-- Which model a conversation with the Assistant is held with
-- (docs/briefs/2026-10-02-assistant-powerful.md, piece B2).
--
-- B2 puts the model picker in the chat: Opus 5 and the Gemini models side by
-- side, with no trip to Settings. Asked how long a choice made there holds,
-- the owner answered on 3 Oct 2026: each conversation its own. A conversation
-- keeps the model it was switched to, and opening it again from History
-- brings that model back with it.
--
--   model   the model this conversation is held with, as the app names it
--           ("claude-opus-5", "gemini-3.8-flash"). NULL: nobody switched it,
--           and it follows the default in the Assistant's settings. That is
--           every conversation before this file, and a new one until
--           somebody picks a model in it.
--
-- No CHECK on it, as with app_settings.ai_model: the list of models is the
-- code's (AI_MODELS), and it changes when Google retires one. A stored model
-- that is no longer offered is read as one that is (aiModelFrom), not
-- refused.
--
-- Not the route. Which way a model is reached follows from the model: Gemini
-- through Google Cloud only, Claude the way the settings say. A column for it
-- here would be a second answer to the same question.
--
-- The table is created first if it is missing. It was made with the rest of
-- the Assistant in August, and no file here creates it. The live database has
-- it, since chat history is in use there, but an ALTER on a missing table
-- stops the deploy, and a restore target or a new box would not have it.
-- Where it exists, the CREATE does nothing. The definition is the one in
-- apps/api/src/db/schema/ai-chats.ts, as the local database has it.
--
-- Defined here and nowhere else; IF NOT EXISTS throughout, so a second run
-- changes nothing.
CREATE TABLE IF NOT EXISTS ai_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New chat',
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  reply jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_chats_user_idx
  ON ai_chats (user_id, updated_at);

ALTER TABLE ai_chats
  ADD COLUMN IF NOT EXISTS model text;

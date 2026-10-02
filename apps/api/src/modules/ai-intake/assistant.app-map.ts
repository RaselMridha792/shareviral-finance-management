import {
  aiFeedbackSchema,
  makeAiRuleSchema,
  setAiInstructionsSchema,
  setAiKeySchema,
  updateAiSettingsSchema,
} from "@finance/shared";

import { appPart } from "../../common/app-map";

/** The Assistant's own entry in the map: what it is, said to itself. */
export const ASSISTANT_MAP = [
  appPart({
    key: "assistant",
    name: "AI Assistant",
    modules: ["ai-intake"],
    purpose:
      "This conversation. It drafts a record for the person to check and save, answers questions about what is recorded, and reads a file somebody attaches. It saves nothing itself.",
    keeps: [
      "The conversations, each person's own.",
      "Its mistakes: what somebody corrected on a draft before saving, and answers somebody marked wrong, with why. Both are shown to it on later turns; the owner can make one a rule.",
    ],
    screens: [
      {
        href: "/assistant",
        name: "AI Assistant",
        does: "The chat, its history and the draft cards. Under its latest answer, This was wrong says why it was not right. Which model answers, and the owner's instructions for it, are under Settings, Assistant.",
      },
      {
        href: "/assistant/knowledge",
        name: "What the Assistant knows",
        does: "The map of the app it is given: every part, its screens and forms, and what it may do in each. For a Super Admin also the owner's rules and its recent mistakes, each of which can be made a rule.",
      },
    ],
    forms: [
      {
        name: "Message",
        on: "/assistant",
        opens: "the box at the bottom of the chat, Send",
        saves: ["POST /ai/turn"],
        onSave:
          "Sends the conversation to the model and shows its answer: a question, a reply, or a draft card. The exchange is kept in the person's history. Nothing is recorded in the books.",
      },
      {
        name: "Attach a spreadsheet",
        on: "/assistant",
        opens: "the paperclip in the message box",
        saves: ["POST /ai/attachments"],
        fields: {
          file: "a CSV, Excel or PDF file, up to 5 MB",
        },
        onSave:
          "Reads the file into rows and totals, for the Assistant to answer from. Nothing enters the books.",
      },
      {
        name: "Remove this file",
        on: "/assistant",
        opens: "the cross on the attached file",
        saves: ["DELETE /ai/attachments/:id"],
        onSave: "Removes the attached file and its rows from the conversation.",
      },
      {
        name: "Send to Import",
        on: "/assistant",
        opens: "the button on an attached file's card",
        saves: ["POST /ai/attachments/:id/to-import"],
        permission: "imports.run",
        onSave:
          "Stages the file's rows on Import and Export, mapped as the Assistant proposed. Nothing is recorded until somebody presses Import there.",
      },
      {
        name: "Delete this conversation",
        on: "/assistant",
        opens: "the bin beside a conversation in the history list",
        saves: ["DELETE /ai/chats/:id"],
        onSave:
          "Deletes the conversation for good. Nothing in the books depended on it.",
      },
      {
        name: "This was wrong",
        on: "/assistant",
        opens: "under the Assistant's latest answer",
        saves: ["POST /ai/feedback"],
        schema: aiFeedbackSchema,
        fields: {
          chatId: "the conversation; the chat sends it, nobody types it",
          reason: "what was wrong, and what would have been right",
        },
        onSave:
          "Keeps the answer as a mistake, with what was asked and why it was wrong, figures masked. It is shown to the Assistant on later turns, and on the owner's list of mistakes.",
      },
      {
        name: "Make this a rule",
        on: "/assistant/knowledge",
        opens: "beside a mistake on the list, Super Admin only",
        saves: ["POST /ai/mistakes/:id/rule"],
        schema: makeAiRuleSchema,
        permission: "settings.write",
        fields: { rule: "one line, in the owner's own words" },
        onSave:
          "Adds the line to the owner's instructions for the Assistant, within their 4,000 characters, and marks the mistake as a rule. The change is in What changed.",
      },
      {
        name: "Remove from the list",
        on: "/assistant/knowledge",
        opens: "beside a mistake on the list, Super Admin only",
        saves: ["DELETE /ai/mistakes/:id"],
        permission: "settings.write",
        onSave:
          "Takes the mistake off the list and out of the Assistant's prompt. A rule made from it stays in the instructions.",
      },
      {
        name: "Instructions for the Assistant",
        on: "/settings",
        opens: "Settings, Assistant section: Save the instructions",
        saves: ["PUT /ai/instructions"],
        schema: setAiInstructionsSchema,
        permission: "settings.write",
        fields: { instructions: "the owner's rules, one a line" },
        onSave:
          "Saves the owner's rules. The Assistant follows them from its next message. Every change is in What changed.",
      },
      {
        name: "Anthropic API key",
        on: "/settings",
        opens: "Settings, Assistant section: Save the key",
        saves: ["POST /ai/key"],
        schema: setAiKeySchema,
        permission: "settings.write",
        onSave:
          "Checks the key with Anthropic, then stores it sealed. Only its last four characters are ever shown again.",
      },
      {
        name: "Remove",
        on: "/settings",
        opens: "Settings, Assistant section, beside the stored Anthropic key",
        saves: ["DELETE /ai/key"],
        permission: "settings.write",
        onSave:
          "Deletes the stored Anthropic key. Through that route the Assistant stops answering until a key is added again.",
      },
      {
        name: "Which model answers",
        on: "/settings",
        opens:
          "Settings, Assistant section: the route, the model and how much it may read; the model also from the picker in the chat",
        saves: ["PATCH /ai/settings"],
        schema: updateAiSettingsSchema,
        permission: "settings.write",
        fields: {
          provider: "the Anthropic key, or Google Cloud",
          dataAccess: "whether it may look up the books at all",
        },
        onSave:
          "Changes it for everybody from their next message. Every change is in What changed.",
      },
    ],
    recordedBy: [],
    permission: "ai.use",
    assistant: {
      drafts: [],
      reads: [],
      otherwise:
        "I cannot change my own settings, my model or the instructions I am given. A Super Admin does that under Settings, Assistant. What I know about the app, my rules and my recent mistakes are on What the Assistant knows.",
    },
  }),
];

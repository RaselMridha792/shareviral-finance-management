import {
  aiConfirmSchema,
  aiFeedbackSchema,
  aiLinkSchema,
  makeAiRuleSchema,
  setAiInstructionsSchema,
  setAiKeySchema,
  setAiUsageLimitSchema,
  setGoogleKeySchema,
  updateAiSettingsSchema,
} from "@finance/shared";

import { appPart } from "../../common/app-map";

/** The Assistant's own entry in the map: what it is, said to itself. */
export const ASSISTANT_MAP = [
  appPart({
    key: "assistant",
    name: "AI Assistant",
    // The Google Cloud key reaches Gemini, and Claude when it is set to go
    // that way, and reads the files whose links are pasted in the chat: it
    // is set up in the Assistant's settings (B2).
    modules: ["ai-intake", "connections"],
    purpose:
      "This conversation. It drafts a record for the person to check and save, answers questions about what is recorded, and reads a file somebody attaches, or a Google Sheet, Doc or Drive file whose link they paste. It saves nothing itself: a draft is saved when the person presses Confirm and save on its card.",
    keeps: [
      "The conversations, each person's own.",
      "Its mistakes: what somebody corrected on a draft before saving, and answers somebody marked wrong, with why. Both are shown to it on later turns; the owner can make one a rule.",
      "Its settings: the model new chats start with, the way Claude is reached, the Anthropic key and the Google Cloud key, how much it may read, and the owner's instructions. Each conversation keeps the model picked for it in the chat.",
      "What it spends: every call to a model, with its tokens, and the company's monthly limit in dollars of estimated cost. At 80% of the limit it warns; at 100% it stops for everybody until the 1st, unless a Super Admin raises it.",
    ],
    screens: [
      {
        href: "/assistant",
        name: "AI Assistant",
        does: "The chat, its history and the draft cards. Under its latest answer, This was wrong says why it was not right. Which model answers this conversation is picked in the message box, beside Send; the conversation keeps it. The default, and the owner's instructions, are in the Assistant's settings, behind the gear. On the right, Usage: this month's tokens, the estimated cost, the limit and how much of it is used; on a phone, behind the Usage button.",
      },
      {
        href: "/assistant/settings",
        name: "Assistant settings",
        does: "The model new chats start with and the way Claude is reached, the Anthropic key (when Claude goes that way) and the Google Cloud key with the address to share files with, how much it may read, the owner's instructions and its recent mistakes, and What it spends: a month by day, person and model, the last twelve months, the prices the estimate is worked out with, and the monthly limit. The Super Admin changes them. The CFO reads them and changes nothing, and sees no key and no Google address.",
      },
      {
        href: "/assistant/knowledge",
        name: "What the Assistant knows",
        does: "The map of the app it is given: every part, its screens and forms, and what it may do in each, with the owner's rules and its recent mistakes above it. A Super Admin can make a mistake a rule.",
      },
    ],
    forms: [
      {
        name: "Message",
        on: "/assistant",
        opens: "the box at the bottom of the chat, Send",
        saves: ["POST /ai/turn"],
        onSave:
          "Sends the conversation to the model picked in the box beside Send, and shows its answer: a question, a reply, or a draft card. The exchange is kept in the person's history, with the model if one was picked, so opening it again brings that model back. Nothing is recorded in the books.",
      },
      {
        name: "Confirm and save",
        on: "/assistant",
        opens:
          "the button on a draft card; on a table of drafts, Confirm on a row, or Confirm and save all under the table's count and total",
        saves: ["POST /ai/confirm"],
        schema: aiConfirmSchema,
        fields: {
          chatId: "the conversation; the chat sends it, nobody types it",
          draft:
            "the card's boxes as the person left them; which kind of record it is, is read from the conversation",
          row: "which row of the table; its values are read from the conversation",
        },
        onSave:
          "Checks the draft again, against the person's role, the map and the record's own form, then saves it the way that form's Save does, as the person, with their permissions. Its audit row says it came through the Assistant. The chat then says what was saved and where it shows, with a link, and the card is not offered again. Only new records: nothing is deleted, voided, finalised or paid, and nothing under Settings or anybody's sign-in is changed.",
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
          "Reads the file into rows and totals, for the Assistant to answer from. An Excel workbook of several sheets is read sheet by sheet, each counted on its own with a card of its own, an empty sheet shown as empty. A workbook whose rows are all on one sheet is read as that sheet, one card, its empty sheets named under it. Nothing enters the books.",
      },
      {
        name: "Attach the invoice",
        on: "/assistant",
        opens:
          "the paperclip with a picture, or with a PDF while a plan is the draft; or Attach on the draft card's Invoice line",
        saves: ["POST /ai/attachments/invoice"],
        fields: {
          file: "a PDF or a picture (PNG, JPG, WebP) of the invoice, up to 5 MB",
        },
        onSave:
          "Reads the invoice's number, date, seller and total off it, for the Assistant to fill in the plan's invoice number. The file stays in the browser and becomes the plan's invoice when the plan is confirmed, as the Add subscription form attaches one. Nothing enters the books.",
      },
      {
        name: "Paste a Google link",
        on: "/assistant",
        opens:
          "a Google Sheet, Doc or Drive file's link pasted into the message box, Send",
        saves: ["POST /ai/attachments/link"],
        schema: aiLinkSchema,
        fields: {
          url: "the link from the file's Share button; the chat finds it in the message",
        },
        onSave:
          "Reads the file with the Google Cloud service account, before the message goes: a Sheet's tab as rows and totals (the tab the link names, or else every tab, each counted on its own with a card of its own), a Doc as its text, an Excel, CSV or PDF file in Drive as if it had been attached (every sheet of a workbook, each on its own). A Sheet or workbook whose rows are all on one tab or sheet is read as that one, one card, the empty ones named under it. A file not shared with the account's address is refused with that address to share it with. Nothing enters the books.",
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
        opens:
          "beside a mistake on the list, here or in the Assistant's settings, Super Admin only",
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
        opens:
          "beside a mistake on the list, here or in the Assistant's settings, Super Admin only",
        saves: ["DELETE /ai/mistakes/:id"],
        permission: "settings.write",
        onSave:
          "Takes the mistake off the list and out of the Assistant's prompt. A rule made from it stays in the instructions.",
      },
      {
        name: "Instructions for the Assistant",
        on: "/assistant/settings",
        opens: "the Instructions card: Save the instructions, Super Admin only",
        saves: ["PUT /ai/instructions"],
        schema: setAiInstructionsSchema,
        permission: "settings.write",
        fields: { instructions: "the owner's rules, one a line" },
        onSave:
          "Saves the owner's rules. The Assistant follows them from its next message. Every change is in What changed.",
      },
      {
        name: "Anthropic API key",
        on: "/assistant/settings",
        opens:
          "the Anthropic API key card, shown while Claude goes through the Anthropic key: Save the key, Super Admin only",
        saves: ["POST /ai/key"],
        schema: setAiKeySchema,
        permission: "settings.write",
        onSave:
          "Checks the key with Anthropic, then stores it sealed. Only its last four characters are ever shown again.",
      },
      {
        name: "Remove",
        on: "/assistant/settings",
        opens: "the Anthropic API key card, beside the stored key",
        saves: ["DELETE /ai/key"],
        permission: "settings.write",
        onSave:
          "Deletes the stored Anthropic key. Through that route the Assistant stops answering until a key is added again.",
      },
      {
        name: "Monthly limit",
        on: "/assistant/settings",
        opens:
          "the What it spends card: the limit's box, Save, and Remove the limit. Super Admin only",
        saves: ["PUT /ai/usage/limit"],
        schema: setAiUsageLimitSchema,
        permission: "settings.write",
        fields: {
          limitUsd:
            "dollars of estimated cost a month, for the whole company; null takes it off",
        },
        onSave:
          "Sets the one limit for everybody, from the next message. At 80% the chat warns; at 100% the Assistant stops until the 1st, before any model is asked. In What changed.",
      },
      {
        name: "Which model answers",
        on: "/assistant/settings",
        opens:
          "the Model card: the model new chats start with and the way Claude goes; the What leaves the building card: how much it may read. Super Admin only",
        saves: ["PATCH /ai/settings"],
        schema: updateAiSettingsSchema,
        permission: "settings.write",
        fields: {
          model:
            "the default, for a new chat and for a chat nobody switched; a conversation's own is picked in the chat",
          provider:
            "the way Claude goes: the Anthropic key, or Google Cloud. Gemini always goes through Google Cloud",
          dataAccess: "whether it may look up the books at all",
        },
        onSave:
          "Changes it for everybody from their next message, except in a conversation whose model was picked in the chat. Every change is in What changed.",
      },
      {
        name: "Connect",
        on: "/assistant/settings",
        opens:
          "The Assistant's settings, Google Cloud card, Super Admin only: paste the key or Choose the .json file, then Connect (Replace the key once one is saved)",
        saves: ["POST /connections/google/key"],
        schema: setGoogleKeySchema,
        fields: {
          serviceAccount:
            "the whole service-account JSON file Google downloads",
        },
        onSave:
          "Checks the key with Google, then stores it encrypted; it is never shown again. The card then shows the address to share Sheets and Docs with. Refused when it is not a service-account key or Google turns it down.",
        permission: "settings.write",
      },
      {
        name: "Remove the Google Cloud key?",
        on: "/assistant/settings",
        opens:
          "The Assistant's settings, Google Cloud card: Remove, beside Test once a key is saved",
        saves: ["DELETE /connections/google/key"],
        onSave:
          "Deletes the key. Shared Sheets and Docs can no longer be read, and Gemini can no longer be picked. Claude, if it went through Google Cloud, goes back to the Anthropic key, and a Gemini default becomes Claude.",
        permission: "settings.write",
      },
      {
        name: "Test",
        on: "/assistant/settings",
        opens:
          "The Assistant's settings, Google Cloud card: Test, beside Copy address once a key is saved",
        saves: ["POST /connections/google/test"],
        onSave:
          "Changes nothing. Asks Google, with the saved key, whether Claude on Vertex AI, Gemini, Sheets, Docs and Drive answer, and lists each as ready or why not.",
        permission: "settings.write",
      },
    ],
    recordedBy: [],
    permission: "ai.use",
    assistant: {
      drafts: [],
      reads: [],
      otherwise:
        "I cannot change my own settings or the instructions I am given. A Super Admin does that in the Assistant's settings, behind the gear on this page. The model answering this conversation can be picked in the message box, beside Send. What I know about the app, my rules and my recent mistakes are on What the Assistant knows.",
    },
  }),
];

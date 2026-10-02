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
      "The conversations, each person's own. What somebody corrected on a draft before saving is kept, and shown to it on later turns.",
    ],
    screens: [
      {
        href: "/assistant",
        name: "AI Assistant",
        does: "The chat, its history and the draft cards. Which model answers, and the owner's instructions for it, are under Settings, Assistant.",
      },
    ],
    recordedBy: [],
    permission: "ai.use",
    assistant: {
      drafts: [],
      reads: [],
      otherwise:
        "I cannot change my own settings, my model or the instructions I am given. A Super Admin does that under Settings, Assistant.",
    },
  }),
];

/**
 * The file tools as the model is offered them (A3b): one file's are exactly
 * as they were; several files (a Sheet's tabs) make each tool say which.
 */
import type { AiAttachment } from "@finance/shared";

import {
  AI_ATTACHMENT_TOOLS,
  attachmentToolsFor,
} from "./ai-attachments.service";

const file = (kind: AiAttachment["kind"]): AiAttachment => ({
  id: "00000000-0000-4000-8000-000000000000",
  name: "Expenses 2026 — Jan (tab 1 of 2)",
  kind,
  rowCount: 1,
  storedRows: 1,
  columns: [],
  sample: [],
  importBatchId: null,
});

describe("the file tools", () => {
  it("are as they were for one file, and a Doc reads alone", () => {
    expect(attachmentToolsFor([file("table")])).toBe(AI_ATTACHMENT_TOOLS);
    expect(attachmentToolsFor([file("text")]).map((t) => t.name)).toEqual([
      "read_attachment",
    ]);
  });

  it("ask which file when there are several, by its number", () => {
    const tools = attachmentToolsFor([file("table"), file("table")]);
    expect(tools.map((t) => t.name)).toEqual([
      "read_attachment",
      "group_attachment",
    ]);
    for (const tool of tools) {
      expect(tool.input_schema.properties).toHaveProperty("file", {
        type: "number",
        description: "Which file, by its number: FILE 1 to FILE 2",
      });
    }
    expect(tools[0].input_schema.required).toEqual(["file"]);
    expect(tools[1].input_schema.required).toEqual(["file", "by"]);
    // The shared list itself is left alone.
    expect(AI_ATTACHMENT_TOOLS[0].input_schema.properties).not.toHaveProperty(
      "file",
    );
  });
});

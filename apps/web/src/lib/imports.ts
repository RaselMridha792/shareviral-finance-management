import { API_BASE_URL, ApiError, apiFetch } from "./api-client";

export type ImportBatch = {
  id: string;
  target: "transactions" | "team_members";
  filename: string;
  status:
    | "uploaded"
    | "mapped"
    | "previewed"
    | "committed"
    | "reverted"
    | "failed";
  columnMap: Record<string, string | null> | null;
  defaults: Record<string, string> | null;
  totalRows: number;
  validRows: number;
  errorRows: number;
  duplicateRows: number;
  importedRows: number;
  committedAt: string | null;
  revertedAt: string | null;
  createdAt: string;
};

export type ImportRow = {
  id: number;
  rowNumber: number;
  raw: Record<string, string | null>;
  mapped: Record<string, string> | null;
  status: "valid" | "error" | "duplicate" | "imported" | "skipped";
  errors: string[] | null;
  warning: string | null;
};

export type UploadResult = {
  batch: ImportBatch;
  headers: string[];
  sample: Record<string, string | null>[];
  suggestion: Record<string, string | null>;
};

const json = (body: unknown) => ({ body: JSON.stringify(body) });

export const importsApi = {
  list: () => apiFetch<ImportBatch[]>("/imports", { cache: "no-store" }),

  /**
   * Not through `apiFetch`: a multipart upload must not carry a JSON
   * Content-Type, and the browser sets its own boundary.
   */
  upload: async (file: File): Promise<UploadResult> => {
    const form = new FormData();
    form.append("file", file);

    const response = await fetch(`${API_BASE_URL}/imports`, {
      method: "POST",
      body: form,
      headers: { "X-Requested-With": "finance-web" },
      credentials: "include",
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        message?: string;
        errors?: Record<string, string[]>;
      } | null;
      throw new ApiError(
        body?.message ?? `Upload failed (${response.status})`,
        response.status,
        body?.errors,
      );
    }

    return response.json() as Promise<UploadResult>;
  },

  applyMapping: (
    id: string,
    input: {
      columnMap: Record<string, string | null>;
      defaults: {
        accountId: string;
        dateFormat: string;
        fallbackCategoryId?: string;
        assumeDirection?: "in" | "out";
      };
    },
  ) => apiFetch<ImportBatch>(`/imports/${id}/mapping`, { method: "POST", ...json(input) }),

  preview: (id: string, page = 1, status?: string) => {
    const params = new URLSearchParams({ page: String(page), pageSize: "50" });
    if (status) params.set("status", status);
    return apiFetch<{
      batch: ImportBatch;
      rows: ImportRow[];
      page: number;
      totalPages: number;
      total: number;
    }>(`/imports/${id}/preview?${params}`, { cache: "no-store" });
  },

  commit: (id: string, skipRows: number[] = []) =>
    apiFetch<{ imported: number }>(`/imports/${id}/commit`, {
      method: "POST",
      ...json({ skipRows }),
    }),

  revert: (id: string) =>
    apiFetch<{ reverted: number }>(`/imports/${id}/revert`, { method: "POST" }),
};

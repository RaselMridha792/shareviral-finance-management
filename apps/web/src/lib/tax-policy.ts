import type { SaveTdsPolicyInput, TdsPolicy, TdsResult } from "@finance/shared";

import { apiFetch } from "./api-client";

/** What the rule endpoints return, with the flag that says which year it is. */
export type TaxPolicyResponse = {
  policy: TdsPolicy;
  /**
   * False when the year asked for has no rule and an earlier one was used.
   * Worth showing: a figure computed under last year's rates is not wrong, but
   * nobody should learn that from a payslip.
   */
  exact: boolean;
};

export type TdsCalculation = TaxPolicyResponse & { result: TdsResult };

export const taxPolicyApi = {
  years: () => apiFetch<number[]>("/tds/policy/years", { cache: "no-store" }),

  forYear: (year: number) =>
    apiFetch<TaxPolicyResponse>(`/tds/policy/${year}`, { cache: "no-store" }),

  save: (year: number, input: SaveTdsPolicyInput) =>
    apiFetch<unknown>(`/tds/policy/${year}`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  calculate: (input: {
    annualSalary: string;
    fiscalYear: number;
    declaredInvestment?: string;
  }) => {
    const query = new URLSearchParams({
      annualSalary: input.annualSalary,
      fiscalYear: String(input.fiscalYear),
      ...(input.declaredInvestment
        ? { declaredInvestment: input.declaredInvestment }
        : {}),
    });
    return apiFetch<TdsCalculation>(`/tds/policy-calculator?${query}`, {
      cache: "no-store",
    });
  },
};

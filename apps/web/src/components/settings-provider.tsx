"use client";

import {
  formatMoney,
  type FiscalYearMode,
  type FormatMoneyOptions,
  type NumberFormat,
} from "@finance/shared";
import { createContext, useContext, type ReactNode } from "react";

export type AppSettingsDto = {
  companyName: string;
  companyEtin: string | null;
  companyBin: string | null;
  companyAddress: string | null;
  companyTagline: string | null;
  companyLegalNote: string | null;
  companyWebsite: string | null;
  companyEmail: string | null;
  payslipSignatoryName: string | null;
  payslipSignatoryTitle: string | null;
  baseCurrency: string;
  secondaryCurrency: string;
  fiscalYearMode: FiscalYearMode;
  numberFormat: NumberFormat;
  fxMode: "fixed" | "live";
  fxFixedUsdBdt: string | null;
  fxProvider: string | null;
  fxLastSyncedAt: string | null;
  fxReportBasis: "period_end" | "period_average" | "current";
  booksLockedThrough: string | null;
  tdsReminderDays: number;
};

const SettingsContext = createContext<AppSettingsDto | null>(null);

export function SettingsProvider({
  settings,
  children,
}: {
  settings: AppSettingsDto;
  children: ReactNode;
}) {
  return (
    <SettingsContext.Provider value={settings}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): AppSettingsDto {
  const settings = useContext(SettingsContext);
  if (!settings) {
    throw new Error("useSettings must be used inside a signed-in layout");
  }
  return settings;
}

/**
 * Formats money the way this company has configured it — Bangladeshi grouping
 * (৳12,50,000) by default, western if they switched it in Settings.
 */
export function useMoney() {
  const settings = useSettings();

  return (value: string | number, options: FormatMoneyOptions = {}) =>
    formatMoney(value, {
      currency: settings.baseCurrency,
      format: settings.numberFormat,
      ...options,
    });
}

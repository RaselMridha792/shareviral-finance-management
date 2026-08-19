import { WithholdingScreen } from "@/components/tax/withholding-screen";
import { tdsApi } from "@/lib/tax";

export const dynamic = "force-dynamic";

export const metadata = { title: "Withholding tax · SFM" };

/**
 * The period is not in the URL any more.
 *
 * It used to be `?year=`, because the screen's only filter was a year and
 * changing it meant a fresh server render. The filter now has three parts and
 * the screen refetches the register itself, the way the reports screen does —
 * so the page's job is the first period only, and which period that is comes
 * from the API rather than from a query string a link could carry a stale one
 * in.
 */
export default async function WithholdingPage() {
  // No period asked for: the API answers with the one we are in, which is what
  // somebody opening the page wants to see.
  const register = await tdsApi.salaryRegister();

  return <WithholdingScreen initial={register} />;
}

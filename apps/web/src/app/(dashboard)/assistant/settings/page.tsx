import { AssistantSettingsScreen } from "@/components/assistant/assistant-settings";
import { aiApi } from "@/lib/ai";

export const dynamic = "force-dynamic";

export const metadata = { title: "Assistant settings · SFM" };

/**
 * The Assistant's own settings (B2, 3 Oct 2026), behind the gear on the chat
 * and in its window. The Super Admin changes them; the CFO reads them.
 *
 * Under /assistant, so the route's own gate (`ai.use`, proxy.ts) holds, and
 * the API answers each read and refuses each write on its own permission.
 */
export default async function AssistantSettingsPage() {
  const availability = await aiApi.availability();
  return <AssistantSettingsScreen initial={availability} />;
}

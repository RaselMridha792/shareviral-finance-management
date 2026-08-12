import { AssistantScreen } from "@/components/assistant/assistant-screen";
import { aiApi } from "@/lib/ai";

export const dynamic = "force-dynamic";

export const metadata = { title: "Assistant · SFM" };

export default async function AssistantPage() {
  // Asked once here rather than in the browser, so the screen knows before it
  // renders whether there is anything to offer.
  const availability = await aiApi
    .availability()
    .catch(() => ({ configured: false, reason: "The API did not answer." }));

  return <AssistantScreen availability={availability} />;
}

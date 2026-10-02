import { KnowledgeScreen } from "@/components/assistant/knowledge-screen";
import { aiApi } from "@/lib/ai";

export const dynamic = "force-dynamic";

export const metadata = { title: "What the Assistant knows · SFM" };

/**
 * What the Assistant knows (2 Oct 2026, piece A2b): the map of the app it is
 * given, and for a Super Admin the rules and its recent mistakes. The
 * owner's way to see why it answered as it did.
 *
 * Under /assistant, so the route's own gate (`ai.use`, proxy.ts) holds.
 */
export default async function AssistantKnowledgePage() {
  const knowledge = await aiApi.knowledge();
  return <KnowledgeScreen knowledge={knowledge} />;
}

import { AssistantScreen } from "@/components/assistant/assistant-screen";
import { ApiError } from "@/lib/api-client";
import { aiApi } from "@/lib/ai";

export const dynamic = "force-dynamic";

export const metadata = { title: "Assistant · SFM" };

export default async function AssistantPage() {
  // Asked once here rather than in the browser, so the screen knows before it
  // renders whether there is anything to offer.
  const availability = await aiApi.availability().catch((error) => ({
    configured: false,
    // A 403 is an answer, and saying "the API did not answer" sends a reader
    // looking for an outage. The CEO account holds no `ai.use` and saw
    // exactly that.
    reason:
      error instanceof ApiError && error.status === 403
        ? "The assistant is not part of your role."
        : "The assistant could not be reached. Try again in a moment.",
  }));

  return <AssistantScreen availability={availability} />;
}

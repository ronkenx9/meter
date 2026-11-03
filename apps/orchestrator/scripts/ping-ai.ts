// `node --env-file=.env apps/orchestrator/scripts/ping-ai.ts`: is the Anthropic key usable? Prints no secrets.
import { createModelClient, pingModel } from "@meter/ai";

const client = createModelClient();
if (!client) {
  console.error("ANTHROPIC_API_KEY is not set");
  process.exit(1);
}
try {
  await pingModel(client);
  console.log("ok");
} catch (e) {
  console.error("failed:", String((e as Error).message).slice(0, 400));
  process.exit(1);
}

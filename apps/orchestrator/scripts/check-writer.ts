// `node --env-file=.env apps/orchestrator/scripts/check-writer.ts [rounds]`: real paragraphs from every tier, with a wider net than
// the writer's own check, because a reply one model accepts another can refuse.
import { fileURLToPath } from "node:url";
import { createModelClient } from "@meter/ai";
import { loadScenario } from "@meter/core";
import { createClaudeWriter } from "@meter/providers";

const scenario = loadScenario(fileURLToPath(new URL("../../../scenario/kit12.json", import.meta.url)));
const client = createModelClient();
if (!client) throw new Error("ANTHROPIC_API_KEY is not set");
const tiers = scenario.providers.filter((p) => p.kind === "model");
const LEAK = /\bparagraph\b|\bthis (report|section) (should|will)\b|should (cover|discuss|address|establish)|\bneeds to (cover|stay)\b|\n\s*\n|^#|\*\*/i;
const rounds = Number(process.argv[2] ?? 5);

let total = 0;
const bad: string[] = [];
await Promise.all(
  tiers.flatMap((tier) =>
    scenario.jobs.map(async (job) => {
      const write = createClaudeWriter(client, scenario);
      for (let i = 1; i <= rounds; i++) {
        total++;
        try {
          const text = await write({ ...tier, clearingKey: "", dropNext: false, loseNext: false }, new URLSearchParams({ job: job.id, step: `model-${i}`, of: String(rounds) }));
          if (LEAK.test(text)) bad.push(`${tier.id} ${job.id}-${i}: ${text}`);
          if (i < rounds && /^(in closing|in conclusion|in summary|to conclude|finally|overall)\b/i.test(text)) bad.push(`${tier.id} ${job.id}-${i}: closes early: ${text}`);
          if (tier.tier === "standard" && job.id === "B") console.log(`\n[${i}/${rounds}] ${text}`);
        } catch (e) {
          bad.push(`${tier.id} ${job.id}-${i}: FAILED ${String(e).slice(0, 200)}`);
        }
      }
    }),
  ),
);
console.log(`${total - bad.length}/${total} clean`);
for (const b of bad) console.log(`\n${b}`);
process.exit(bad.length ? 1 : 0);

// What the providers actually sell: paragraphs from the model behind each tier, and research notes for search
// and lookup. Each job's text so far is kept here so paragraphs build on each other.

import { type ModelClient, TIER_MODELS } from "@meter/ai";
import type { Scenario } from "@meter/core";
import type { LiveProvider, Writer } from "./app.ts";

const SYSTEM = `You write one paragraph at a time of a short research report for a paying customer. Be concrete and useful.
Do not invent statistics, sources, quotes or named studies. If a figure would be needed, describe what to measure instead.
"paragraph" is the finished report text the customer reads: one paragraph, starting directly with its first sentence, with no headings or markdown, and no mention of what the paragraph does.`;

const NOTES_SYSTEM = `You prepare background notes for a research report. Give 2 or 3 short plain sentences on what matters for the topic and what to check.
You have no web or database access, so never present anything as a retrieved result, and do not invent statistics, sources or quotes.
Output only the notes.`;

// A prompt alone still let about 1 in 24 Haiku paragraphs talk about themselves, so check before selling one.
const PARAGRAPH_SCHEMA = {
  type: "object",
  properties: { paragraph: { type: "string" } },
  required: ["paragraph"],
  additionalProperties: false,
};
const TALKS_ABOUT_ITSELF = /\bparagraph\b|should (cover|discuss|address)|\n\s*\n|^#|\*\*/i;
const CLOSES_EARLY = /^(in closing|in conclusion|in summary|to conclude|to sum up|finally|overall)\b/i;
const PARAGRAPH_TRIES = 3;

export function createClaudeWriter(client: ModelClient, scenario: Scenario): Writer {
  const briefs = new Map(scenario.jobs.map((j) => [j.id, j.brief]));
  const written = new Map<string, Map<string, string>>();

  return async (p: LiveProvider, query: URLSearchParams) => {
    const job = query.get("job") ?? "";
    const step = query.get("step") ?? "";
    const brief = briefs.get(job);
    if (!brief) throw new Error(`no brief for job ${job}`);
    const sofar = written.get(job) ?? new Map<string, string>();
    written.set(job, sofar);
    const context = [...sofar.values()].slice(-3).join("\n\n");

    if (p.kind !== "model") {
      const { text } = await client.complete({
        model: TIER_MODELS.basic!,
        system: NOTES_SYSTEM,
        user: `Topic: ${brief}\nThese notes are ${p.kind === "search" ? "the angles a search should cover" : "the data a lookup should pull"}.`,
        effort: "low",
        maxTokens: 1500,
      });
      sofar.set(step, text);
      return text;
    }

    // Where it sits decides how it reads. A long report can grow mid-run, so this comes with each request.
    const at = Number(step.replace(/^model-/, ""));
    const of = Number(query.get("of") ?? 0);
    const last = of > 0 && at >= of;
    const place = at === 1 ? "This opens the report: say what it covers and why that matters." : last ? "This ends the report: draw it to a conclusion." : "The report continues after this: do not open or conclude it.";

    for (let attempt = 1; attempt <= PARAGRAPH_TRIES; attempt++) {
      const { text } = await client.complete({
        model: TIER_MODELS[p.tier ?? "basic"] ?? TIER_MODELS.basic!,
        system: SYSTEM,
        user: `Report topic: ${brief}\n\nMost recent text:\n${context || "(nothing yet)"}\n\nWrite the next paragraph of the report, about 70 words, moving it forward without repeating it. ${place}`,
        effort: p.tier === "premium" ? "medium" : "low",
        maxTokens: 3000,
        schema: PARAGRAPH_SCHEMA,
      });
      const paragraph = (JSON.parse(text) as { paragraph: string }).paragraph.trim();
      if (!paragraph || TALKS_ABOUT_ITSELF.test(paragraph) || (!last && CLOSES_EARLY.test(paragraph))) continue;
      sofar.set(step, paragraph);
      return paragraph;
    }
    throw new Error(`${p.id} kept describing the paragraph instead of writing it`);
  };
}

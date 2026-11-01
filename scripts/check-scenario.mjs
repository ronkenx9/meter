// Checks scenario/kit12.json against the numbers in the official Kit 12 text, parsed from the saved guide.
// The guide is the oracle: nothing here is copied from the scenario file.
import { readFileSync } from "node:fs";

const guide = readFileSync(new URL("../research/builder-guide.md", import.meta.url), "utf8");
const start = guide.indexOf("### 12. Inference Sourcing Agent");
if (start < 0) throw new Error("Kit 12 section not found in research/builder-guide.md");
const kit = guide.slice(start, guide.indexOf("\n## ", start)).replace(/\\\$/g, "$").replace(/\\\*/g, "*");

const need = (re, what) => {
  const m = re.exec(kit);
  if (!m) throw new Error(`could not find ${what} in Kit 12 text`);
  return m;
};

const holds = need(/holds of \$(\d+\.\d{2}), \$(\d+\.\d{2}) and \$(\d+\.\d{2})/, "holds").slice(1, 4);
const float = need(/float is (\d+\.\d{2}) \*USDZ, less than the (\d+\.\d{2})/, "float");
const models = need(/charge (\d+), (\d+) and (\d+) cents a paragraph, a web search (\d+) cents and a data lookup (\d+)/, "prices");
const mult = need(/runs to (\w+) times the tokens/, "overrun multiplier")[1];
const words = { two: 2, three: 3, four: 4, five: 5 };

const s = JSON.parse(readFileSync(new URL("../scenario/kit12.json", import.meta.url), "utf8"));
const cents = (usd) => Math.round(Number(usd) * 100);
const problems = [];
const eq = (what, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${what}: scenario ${JSON.stringify(got)} vs kit ${JSON.stringify(want)}`);
};

eq("holds", s.jobs.map((j) => cents(j.holdUsd)), holds.map(cents));
eq("float", cents(s.floatUsdz), cents(float[1]));
eq("sum of holds", s.jobs.reduce((a, j) => a + cents(j.holdUsd), 0), cents(float[2]));
const byKind = (k) => s.providers.filter((p) => p.kind === k).map((p) => cents(p.priceUsdz)).sort((a, b) => a - b);
eq("model prices", byKind("model"), models.slice(1, 4).map(Number));
eq("search price", byKind("search"), [Number(models[4])]);
eq("lookup price", byKind("lookup"), [Number(models[5])]);
eq("overrun multiplier", s.shock.tokenMultiplier, words[mult] ?? Number(mult));
const cheapest = s.providers.filter((p) => p.kind === "model").sort((a, b) => cents(a.priceUsdz) - cents(b.priceUsdz))[0];
eq("slowed provider is the cheapest", s.shock.slowProvider, cheapest.id);
eq("jobs run at once", s.jobs.length, /Three jobs run at once/.test(kit) ? 3 : -1);

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`holds=${holds.join(",")} float=${float[1]} models=${models.slice(1, 4).join(",")}c x${s.shock.tokenMultiplier}`);
console.log("SCENARIO_MATCHES_KIT12");

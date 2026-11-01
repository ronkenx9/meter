// .env must be ignored, and no file git would commit may hold a credential-shaped value.
// Positive control: the same scan runs on a planted fixture string and must catch it.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });

for (const f of [".env", ".env.local", "runs/x.jsonl", "wallets/A/key"]) {
  try {
    git("check-ignore", "-q", f);
  } catch {
    console.error(`${f} is not git-ignored`);
    process.exit(1);
  }
}

const PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{20,}/, // Anthropic
  /\b0x[0-9a-fA-F]{64}\b/, // raw private key
  /^\s*(AWX_API_KEY|AWX_CLIENT_ID|AWX_WEBHOOK_SECRET|ANTHROPIC_API_KEY|METAL_OPERATOR_KEY)[ \t]*=[ \t]*[^\s#]+/m, // filled env line
  /rpc-testnet\.metalntwx\.com\/v1\/[A-Za-z0-9]{8,}/, // RPC URL is its own credential
];
const scan = (text) => PATTERNS.find((p) => p.test(text));

if (!scan(`ANTHROPIC_API_KEY=sk-ant-${"x".repeat(30)}`)) {
  console.error("scanner failed its positive control");
  process.exit(1);
}

const files = git("ls-files", "--cached", "--others", "--exclude-standard").split("\n").filter(Boolean);
const hits = [];
for (const f of files) {
  if (f.startsWith("research/")) continue; // saved public docs; may show example keys
  let text;
  try {
    text = readFileSync(new URL(f, root), "utf8");
  } catch {
    continue;
  }
  const p = scan(text);
  if (p) hits.push(`${f} matches ${p}`);
}
if (hits.length) {
  console.error(hits.join("\n"));
  process.exit(1);
}
console.log(`scanned=${files.length}`);
console.log("SECRETS_OK");

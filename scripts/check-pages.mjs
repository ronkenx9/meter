// The site serves what it links to: the landing page, the app, the docs, and the recording the walkthrough plays,
// byte for byte. Starts its own server on a spare port. Usage: check-pages.mjs
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const PORT = 4391;
const base = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ["apps/orchestrator/src/server.ts"], { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
const fail = (m) => { server.kill(); console.error(m); process.exit(1); };
const get = (p) => fetch(base + p).then(async (r) => ({ status: r.status, type: r.headers.get("content-type") ?? "", body: await r.text() }));

for (let i = 0; ; i++) {
  if (await get("/api/state").then(() => true, () => false)) break;
  if (i > 50) fail("server never started");
  await new Promise((r) => setTimeout(r, 200));
}
const pages = { "/": "AI work", "/app": "Run simulation", "/docs": "How METER works", "/approve": "METER" };
for (const [path, text] of Object.entries(pages)) {
  const r = await get(path);
  if (r.status !== 200 || !r.type.includes("html") || !r.body.includes(text)) fail(`${path}: ${r.status}, missing "${text}"`);
}
// Every same-site link on the three pages goes somewhere that answers.
const links = new Set();
for (const path of ["/", "/docs"]) for (const m of (await get(path)).body.matchAll(/href="(\/[^"#]*)/g)) links.add(m[1].split("?")[0] || "/");
for (const l of links) if ((await get(l)).status !== 200) fail(`broken link ${l}`);
// Every in-page anchor on the docs has a target.
const docs = (await get("/docs")).body;
for (const m of docs.matchAll(/href="#([^"]+)"/g)) if (!docs.includes(`id="${m[1]}"`)) fail(`docs anchor #${m[1]} has no target`);
const rec = await get("/api/recordings/kit12");
if (rec.status !== 200 || rec.body !== readFileSync("research/live-kit12-run.jsonl", "utf8")) fail("the walkthrough's recording differs from research/live-kit12-run.jsonl");
if ((await get("/api/recordings/nope")).status !== 404) fail("an unknown recording did not 404");
if ((await get("/api/recordings/..%2F.env")).status !== 404) fail("a path outside the recordings did not 404");
server.kill();
console.log(`PAGES_OK ${Object.keys(pages).length} pages, ${links.size} links, docs anchors resolve, walkthrough recording matches the file`);

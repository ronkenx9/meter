// Copies a finished run's hash-chained log into research/ as evidence, after checking the chain is intact.
// Usage: export-run.ts <runs/*.sqlite> <research/name.jsonl>
import { writeFileSync } from "node:fs";
import { EventLog } from "@meter/ledger";

const [from, to] = process.argv.slice(2);
if (!from || !to) throw new Error("usage: export-run.ts <run.sqlite> <out.jsonl>");
const log = new EventLog(from);
const bad = log.verify();
if (bad !== null) throw new Error(`hash chain broken at event ${bad}`);
const events = log.all();
writeFileSync(to, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
console.log(`exported ${events.length} events to ${to}`);

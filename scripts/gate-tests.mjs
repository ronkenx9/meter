// Runs the vitest suite with a JSON report and passes only if tests ran and none failed.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = join(mkdtempSync(join(tmpdir(), "meter-tests-")), "report.json");
const run = spawnSync("pnpm", ["-s", "vitest", "run", "--reporter=json", `--outputFile=${out}`], {
  cwd: new URL("..", import.meta.url),
  encoding: "utf8",
});
let report;
try {
  report = JSON.parse(readFileSync(out, "utf8"));
} catch {
  console.error(run.stdout, run.stderr);
  console.error("no vitest report written");
  process.exit(1);
}
const { numTotalTests: total, numFailedTests: failed, numPendingTests: skipped, success } = report;
if (!success || failed !== 0 || total === 0 || run.status !== 0) {
  console.error(`vitest: total=${total} failed=${failed} exit=${run.status}`);
  process.exit(1);
}
console.log(`TESTS_OK total=${total} failed=${failed} skipped=${skipped}`);

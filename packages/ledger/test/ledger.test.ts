import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EventLog } from "../src/index.ts";

describe("EventLog", () => {
  it("chains events and stringifies bigints", () => {
    const log = new EventLog(":memory:");
    log.append("hold.placed", "A", { amount: 100n });
    const e = log.append("paid", "A", { price: 10_000n });
    expect(e.seq).toBe(2);
    expect(e.data.price).toBe("10000");
    expect(log.all(1).map((x) => x.type)).toEqual(["paid"]);
    expect(log.verify()).toBeNull();
  });

  it("notifies subscribers until they leave", () => {
    const log = new EventLog(":memory:");
    const seen: string[] = [];
    const off = log.subscribe((e) => seen.push(e.type));
    log.append("a", null);
    off();
    log.append("b", null);
    expect(seen).toEqual(["a"]);
  });

  it("detects an edited amount and resumes the chain after a restart", () => {
    const path = join(mkdtempSync(join(tmpdir(), "meter-ledger-")), "run.sqlite");
    const log = new EventLog(path);
    log.append("captured", "A", { amount: "0.37" });
    log.append("captured", "B", { amount: "0.50" });
    log.close();

    const reopened = new EventLog(path);
    reopened.append("captured", "C", { amount: "0.20" });
    expect(reopened.verify()).toBeNull();
    reopened.close();

    const db = new DatabaseSync(path);
    db.prepare("UPDATE events SET data = ? WHERE seq = 2").run(JSON.stringify({ amount: "0.05" }));
    db.close();
    const tampered = new EventLog(path);
    expect(tampered.verify()).toBe(2);
    tampered.close();
  });
});

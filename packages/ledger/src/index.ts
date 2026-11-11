// Append-only, hash-chained run log. Every money move and decision lands here, so a judge can
// replay a run and detect any edit: each row's hash covers the previous hash and its own content.

import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export interface LogEvent {
  seq: number;
  at: string;
  type: string;
  job: string | null;
  data: Record<string, unknown>;
  prev: string;
  hash: string;
}

const GENESIS = "0".repeat(64);

function digest(prev: string, seq: number, at: string, type: string, job: string | null, data: string): string {
  return createHash("sha256").update(JSON.stringify([prev, seq, at, type, job, data])).digest("hex");
}

/** bigint amounts are stored as strings so the log stays plain JSON. */
function encode(data: Record<string, unknown>): string {
  return JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

/** Checks an exported log's chain without a database. Returns the first bad seq, or null if intact. */
export function verifyEvents(events: readonly LogEvent[]): number | null {
  let prev = GENESIS;
  for (const e of events) {
    if (e.prev !== prev || digest(prev, e.seq, e.at, e.type, e.job, JSON.stringify(e.data)) !== e.hash) return e.seq;
    prev = e.hash;
  }
  return null;
}

export class EventLog {
  private readonly db: DatabaseSync;
  private readonly listeners = new Set<(e: LogEvent) => void>();
  private last: { seq: number; hash: string };

  /** Use ":memory:" for tests. */
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY, at TEXT NOT NULL, type TEXT NOT NULL, job TEXT, data TEXT NOT NULL, prev TEXT NOT NULL, hash TEXT NOT NULL
    )`);
    const row = this.db.prepare("SELECT seq, hash FROM events ORDER BY seq DESC LIMIT 1").get() as { seq: number; hash: string } | undefined;
    this.last = row ?? { seq: 0, hash: GENESIS };
  }

  append(type: string, job: string | null, data: Record<string, unknown> = {}): LogEvent {
    const seq = this.last.seq + 1;
    const at = new Date().toISOString();
    const body = encode(data);
    const hash = digest(this.last.hash, seq, at, type, job, body);
    this.db.prepare("INSERT INTO events (seq, at, type, job, data, prev, hash) VALUES (?, ?, ?, ?, ?, ?, ?)").run(seq, at, type, job, body, this.last.hash, hash);
    const event: LogEvent = { seq, at, type, job, data: JSON.parse(body), prev: this.last.hash, hash };
    this.last = { seq, hash };
    for (const l of this.listeners) l(event);
    return event;
  }

  all(afterSeq = 0): LogEvent[] {
    const rows = this.db.prepare("SELECT * FROM events WHERE seq > ? ORDER BY seq").all(afterSeq) as unknown as Array<Omit<LogEvent, "data"> & { data: string }>;
    return rows.map((r) => ({ ...r, data: JSON.parse(r.data) }));
  }

  subscribe(listener: (e: LogEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Recomputes the chain from the stored rows. Returns the first bad seq, or null if intact. */
  verify(): number | null {
    let prev = GENESIS;
    const rows = this.db.prepare("SELECT * FROM events ORDER BY seq").all() as unknown as Array<Omit<LogEvent, "data"> & { data: string }>;
    for (const r of rows) {
      if (r.prev !== prev || digest(prev, r.seq, r.at, r.type, r.job, r.data) !== r.hash) return r.seq;
      prev = r.hash;
    }
    return null;
  }

  close(): void {
    this.db.close();
  }
}

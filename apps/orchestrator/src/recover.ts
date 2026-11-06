// After a crash: close every hold the run left open, from the log and each wallet's own record, so nobody's card
// stays held and nobody is charged for more than their wallet paid. It doesn't resume the jobs; it settles them.
// Safe to run again: anything already closed, here or at the card processor, is only recorded.

import { type Cents, type Millionths, formatUsd, formatUsdz, millionths, parseUsd, parseUsdz, sumMillionths } from "@meter/core";
import type { EventLog } from "@meter/ledger";
import { closeAction } from "@meter/policy";
import type { HoldsPort, WalletPort } from "./ports.ts";

export interface RecoveredJob {
  id: string;
  outcome: "captured" | "cancelled" | "already_closed" | "blocked" | "no_hold";
  captured: Cents | null;
  walletSpent: Millionths;
  unused: Millionths;
}

interface Known {
  intentId: string | null;
  authorized: Cents;
  deposited: Millionths;
  closed: boolean;
}

/** The log writes card amounts as "$0.75". */
const dollars = (v: string) => parseUsd(v.replace("$", ""));

/** What the log says about each job. A crash can cut it short, so the card processor and wallets have the last word. */
function readLog(log: EventLog): Map<string, Known> {
  const jobs = new Map<string, Known>();
  const at = (id: string) => {
    let k = jobs.get(id);
    if (!k) jobs.set(id, (k = { intentId: null, authorized: parseUsd("0"), deposited: millionths(0n), closed: false }));
    return k;
  };
  for (const e of log.all()) {
    if (!e.job) continue;
    const k = at(e.job);
    const d = e.data as Record<string, string>;
    if (e.type === "hold.awaiting_customer") k.intentId = d.intentId!;
    if (e.type === "hold.placed") {
      k.intentId = d.intentId!;
      k.authorized = dollars(d.amount!);
    }
    if (e.type === "hold.raised") k.authorized = dollars(d.authorized!);
    if (e.type === "float.deposited") k.deposited = millionths(k.deposited + parseUsdz(d.amount!));
    if (e.type === "hold.captured" || e.type === "hold.cancelled" || e.type === "recovery.captured" || e.type === "recovery.cancelled") k.closed = true;
  }
  return jobs;
}

export async function recover(log: EventLog, holds: HoldsPort, wallet: (jobId: string) => Promise<WalletPort>): Promise<RecoveredJob[]> {
  log.append("recovery.started", null, {});
  const out: RecoveredJob[] = [];
  for (const [id, k] of readLog(log)) {
    const w = await wallet(id);
    const paid = (await w.payments()).map((p) => p.amount);
    const walletSpent = sumMillionths(paid);
    const unused = millionths(k.deposited - walletSpent);
    const row = (outcome: RecoveredJob["outcome"], captured: Cents | null): RecoveredJob => ({ id, outcome, captured, walletSpent, unused });

    if (!k.intentId) {
      out.push(row("no_hold", null));
      continue;
    }
    const now = await holds.read(k.intentId);
    if (now.status === "SUCCEEDED" || now.status === "CANCELLED") {
      // Closed before the crash, perhaps without the log hearing of it.
      log.append("recovery.already_closed", id, { intentId: k.intentId, status: now.status, captured: formatUsd(now.captured), walletSpent: formatUsdz(walletSpent) });
      out.push(row("already_closed", now.status === "SUCCEEDED" ? now.captured : null));
      continue;
    }
    if (now.status !== "REQUIRES_CAPTURE") {
      // Never approved by the customer: there is nothing to charge.
      const r = await holds.cancel(k.intentId, "run stopped before the customer approved the hold");
      log.append("recovery.cancelled", id, { intentId: k.intentId, was: now.status, status: r.status });
      out.push(row("cancelled", null));
      continue;
    }
    // The wallet's record is the spend: a crash can lose the log's last payment, never the wallet's.
    const result = closeAction({ id, authorized: now.authorized, deposited: k.deposited, spent: walletSpent, captured: null, cancelled: false }, paid);
    if (!result.ok) {
      log.append("recovery.blocked", id, { intentId: k.intentId, reason: result.reason, detail: result.detail });
      out.push(row("blocked", null));
      continue;
    }
    if (result.action.kind === "cancel") {
      const r = await holds.cancel(k.intentId, "run stopped before anything was paid");
      log.append("recovery.cancelled", id, { intentId: k.intentId, status: r.status });
      out.push(row("cancelled", null));
      continue;
    }
    const r = await holds.capture(k.intentId, result.action.amount);
    log.append("recovery.captured", id, { intentId: k.intentId, captured: formatUsd(r.captured), authorized: formatUsd(now.authorized), walletSpent: formatUsdz(walletSpent), status: r.status });
    out.push(row("captured", r.captured));
  }
  for (const j of out) {
    if (j.unused <= 0n) continue;
    // Queues the unused float; it can be claimed once final, by running recovery again or claiming directly.
    const r = await (await wallet(j.id)).withdraw();
    log.append("recovery.withdraw_requested", j.id, { unused: formatUsdz(j.unused), status: r.status });
  }
  log.append("recovery.finished", null, { jobs: out.map((j) => ({ id: j.id, outcome: j.outcome, captured: j.captured === null ? null : formatUsd(j.captured), walletSpent: formatUsdz(j.walletSpent) })) });
  return out;
}

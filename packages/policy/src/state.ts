// Per-job lifecycle. Transitions not listed here are bugs, so they throw.

export type JobState =
  | "quoted"
  | "hold_requested"
  | "held"
  | "funded"
  | "running"
  | "rerouting"
  | "over_budget"
  | "awaiting_hold_raise"
  | "draining"
  | "capturing"
  | "captured"
  | "cancelled"
  | "float_withdraw_queued"
  | "float_withdrawn";

const NEXT: Record<JobState, readonly JobState[]> = {
  quoted: ["hold_requested", "cancelled"],
  hold_requested: ["held", "cancelled"],
  held: ["funded", "cancelled"],
  funded: ["running", "draining"],
  running: ["rerouting", "over_budget", "draining"],
  rerouting: ["running", "draining"],
  over_budget: ["awaiting_hold_raise", "running", "draining"],
  // Approved: the increment is confirmed, then the top-up lands, then the job resumes.
  // Declined or timed out: the job finishes within the hold it has.
  awaiting_hold_raise: ["running", "draining"],
  draining: ["capturing", "cancelled"],
  capturing: ["captured"],
  captured: ["float_withdraw_queued", "float_withdrawn"],
  cancelled: ["float_withdraw_queued", "float_withdrawn"],
  float_withdraw_queued: ["float_withdrawn"],
  float_withdrawn: [],
};

export class TransitionError extends Error {
  override name = "TransitionError";
}

export function canTransition(from: JobState, to: JobState): boolean {
  return NEXT[from].includes(to);
}

export function assertTransition(from: JobState, to: JobState): JobState {
  if (!canTransition(from, to)) throw new TransitionError(`job cannot move from ${from} to ${to}`);
  return to;
}

/** States in which the card hold is open and must still end in a capture or cancel. */
export function holdIsOpen(state: JobState): boolean {
  return ["held", "funded", "running", "rerouting", "over_budget", "awaiting_hold_raise", "draining", "capturing"].includes(state);
}

/** States in which the job may pay a provider. */
export function mayPay(state: JobState): boolean {
  return state === "running";
}

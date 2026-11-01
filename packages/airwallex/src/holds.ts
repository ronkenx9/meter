// Card holds for METER tabs: create + confirm as pre-auth, raise, capture once, cancel.
// Amounts cross this boundary as Cents and go to Airwallex as major units.

import { type Cents, centsToMajor, parseUsd } from "@meter/core";
import type { AirwallexClient } from "./client.ts";

export type IntentStatus =
  | "REQUIRES_PAYMENT_METHOD"
  | "REQUIRES_CUSTOMER_ACTION"
  | "PENDING_REVIEW"
  | "REQUIRES_CAPTURE"
  | "PENDING"
  | "SUCCEEDED"
  | "CANCELLED";

export interface PaymentIntent {
  id: string;
  status: IntentStatus;
  amount: number;
  currency: string;
  captured_amount?: number;
  /** Returned on create; valid 60 minutes; only the customer's browser should see it. */
  client_secret?: string;
  merchant_order_id?: string;
  latest_payment_attempt?: {
    id?: string;
    status?: string;
    amount?: number;
    captured_amount?: number;
    authorization_code?: string;
    payment_method_options?: { card?: { authorization_type?: string; auto_capture?: boolean } };
  };
  cancellation_reason?: string;
}

export interface TestCard {
  number: string;
  expiry_month: string;
  expiry_year: string;
  cvc: string;
  name: string;
}

/** Card-side view of a hold, in cents. */
export interface HoldState {
  intentId: string;
  status: IntentStatus;
  authorized: Cents;
  captured: Cents;
}

export function holdState(pi: PaymentIntent): HoldState {
  return {
    intentId: pi.id,
    status: pi.status,
    authorized: parseUsd(pi.amount),
    captured: parseUsd(pi.captured_amount ?? 0),
  };
}

const base = "/api/v1/pa/payment_intents";

export async function createIntent(
  awx: AirwallexClient,
  args: { amount: Cents; currency: "USD"; merchantOrderId: string; requestId: string; descriptor?: string; metadata?: Record<string, string> },
): Promise<PaymentIntent> {
  return awx.post<PaymentIntent>(`${base}/create`, {
    request_id: args.requestId,
    amount: centsToMajor(args.amount),
    currency: args.currency,
    merchant_order_id: args.merchantOrderId,
    ...(args.descriptor ? { descriptor: args.descriptor } : {}),
    ...(args.metadata ? { metadata: args.metadata } : {}),
  });
}

/** Server-side confirm with card details. Sandbox test cards only; production would need PCI scope or hosted fields. */
export async function confirmPreAuth(
  awx: AirwallexClient,
  intentId: string,
  args: { requestId: string; card: TestCard },
): Promise<PaymentIntent> {
  return awx.post<PaymentIntent>(`${base}/${intentId}/confirm`, {
    request_id: args.requestId,
    payment_method: { type: "card", card: args.card },
    payment_method_options: { card: { authorization_type: "pre_auth", auto_capture: false } },
  });
}

/** Raise the hold to a new total. Airwallex requires newTotal above the current authorized total. */
export async function incrementHold(
  awx: AirwallexClient,
  intentId: string,
  args: { newTotal: Cents; requestId: string },
): Promise<PaymentIntent> {
  return awx.post<PaymentIntent>(`${base}/${intentId}/increment_authorization`, {
    request_id: args.requestId,
    amount: centsToMajor(args.newTotal),
  });
}

export async function captureHold(
  awx: AirwallexClient,
  intentId: string,
  args: { amount: Cents; requestId: string },
): Promise<PaymentIntent> {
  return awx.post<PaymentIntent>(`${base}/${intentId}/capture`, {
    request_id: args.requestId,
    amount: centsToMajor(args.amount),
  });
}

export async function cancelHold(
  awx: AirwallexClient,
  intentId: string,
  args: { requestId: string; reason: string },
): Promise<PaymentIntent> {
  return awx.post<PaymentIntent>(`${base}/${intentId}/cancel`, {
    request_id: args.requestId,
    cancellation_reason: args.reason,
  });
}

export async function getIntent(awx: AirwallexClient, intentId: string): Promise<PaymentIntent> {
  return awx.get<PaymentIntent>(`${base}/${intentId}`);
}

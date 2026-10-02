import { jsonResponse } from "../_shared/cors.ts";
import { verifyPaystackSignature, verifyPaystackTransaction } from "../_shared/paystack.ts";
import { processDepartmentAccessPayment } from "../_shared/processPayment.ts";

// Paystack calls this directly — no user JWT, no CORS preflight expected (server-to-server).
// Authenticity comes entirely from the x-paystack-signature header, verified below.
Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature");

  if (!(await verifyPaystackSignature(rawBody, signature))) {
    return jsonResponse({ error: "Invalid signature" }, 401);
  }

  const event = JSON.parse(rawBody);

  if (event.event !== "charge.success") {
    // Not an error — Paystack sends many event types; we only act on this one.
    return jsonResponse({ received: true });
  }

  const { reference, metadata } = event.data;
  const userId = metadata?.user_id;
  const departmentId = metadata?.department_id;

  if (!userId || !departmentId) {
    console.error("paystack-webhook: charge.success missing user_id/department_id metadata", {
      reference,
    });
    return jsonResponse({ received: true }); // ack anyway — Paystack retries on non-2xx
  }

  try {
    // Re-verify directly with Paystack rather than trusting the webhook body's own amount/status
    // fields — the signature proves the request came from Paystack, not that the embedded data
    // hasn't been superseded by a later event for the same reference.
    const paystack = await verifyPaystackTransaction(reference);
    await processDepartmentAccessPayment({ reference, userId, departmentId, paystack });
  } catch (err) {
    console.error("paystack-webhook: processing failed", err);
    // Still ack 200 — verify-payment is the fallback path if this swallowed a real success,
    // and returning non-2xx here would just cause Paystack to retry the same failure.
  }

  return jsonResponse({ received: true });
});

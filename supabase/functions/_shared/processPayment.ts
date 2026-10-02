// Shared by verify-payment (client-triggered) and paystack-webhook (push-based) — whichever
// reaches "success" first wins; the unique constraint on payments(provider, provider_reference)
// makes the second arrival a no-op, not a duplicate grant. Only `department_access` is
// implemented today — `suspension_reactivation` is a valid payment_purpose in the schema for
// later, but nothing in the app can suspend a user yet (that's the admin-manage-user function,
// not built in this pass), so there is deliberately no code path for it to reach here yet.
import { serviceClient, HttpError } from "./supabaseClients.ts";
import type { PaystackVerifyResult } from "./paystack.ts";

interface ProcessArgs {
  reference: string;
  userId: string;
  departmentId: string;
  paystack: PaystackVerifyResult;
}

export async function processDepartmentAccessPayment({
  reference,
  userId,
  departmentId,
  paystack,
}: ProcessArgs) {
  const db = serviceClient();

  if (!paystack.status || paystack.data.status !== "success") {
    throw new HttpError(402, "Payment was not successful.");
  }

  // Idempotency: if this reference was already recorded as a success, don't re-process —
  // just confirm the grant exists (covers the case where the webhook already landed it).
  const { data: existing } = await db
    .from("payments")
    .select("id, status")
    .eq("provider", "paystack")
    .eq("provider_reference", reference)
    .maybeSingle();

  if (existing?.status === "success") {
    return { alreadyProcessed: true };
  }

  // Real price, looked up server-side — never trust a client-supplied amount. "Current price"
  // is the row with the latest effective_from that isn't in the future.
  const { data: priceRow, error: priceError } = await db
    .from("department_pricing")
    .select("amount, access_duration_days")
    .eq("department_id", departmentId)
    .eq("currency", paystack.data.currency)
    .lte("effective_from", new Date().toISOString())
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (priceError || !priceRow) {
    throw new HttpError(500, "No price configured for this department/currency.");
  }

  const expectedKobo = Math.round(Number(priceRow.amount) * 100);
  if (paystack.data.amount !== expectedKobo) {
    throw new HttpError(
      402,
      `Amount mismatch: paid ${paystack.data.amount}, expected ${expectedKobo}.`,
    );
  }

  const paymentRow = existing
    ? await db
        .from("payments")
        .update({
          status: "success",
          verified_at: new Date().toISOString(),
          raw_provider_response: paystack.data,
        })
        .eq("id", existing.id)
        .select("id")
        .single()
    : await db
        .from("payments")
        .insert({
          user_id: userId,
          provider: "paystack",
          provider_reference: reference,
          purpose: "department_access",
          department_id: departmentId,
          amount: priceRow.amount,
          currency: paystack.data.currency,
          status: "success",
          verified_at: new Date().toISOString(),
          raw_provider_response: paystack.data,
        })
        .select("id")
        .single();

  if (paymentRow.error || !paymentRow.data) {
    throw new HttpError(500, paymentRow.error?.message ?? "Failed to record payment.");
  }

  const expiresAt = priceRow.access_duration_days
    ? new Date(Date.now() + priceRow.access_duration_days * 86_400_000).toISOString()
    : null;

  const { error: grantError } = await db.from("access_grants").upsert(
    {
      user_id: userId,
      department_id: departmentId,
      granted_via_payment_id: paymentRow.data.id,
      expires_at: expiresAt,
    },
    { onConflict: "user_id,department_id" },
  );

  if (grantError) throw new HttpError(500, grantError.message);

  return { alreadyProcessed: false };
}

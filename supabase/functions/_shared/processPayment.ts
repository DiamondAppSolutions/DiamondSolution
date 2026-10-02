// Shared by verify-payment (client-triggered) and paystack-webhook (push-based) — whichever
// reaches "success" first wins; the unique constraint on payments(provider, provider_reference)
// makes the second arrival a no-op, not a duplicate grant. Only `department_access` is
// implemented today — `suspension_reactivation` is a valid payment_purpose in the schema for
// later, but nothing in the app can suspend a user yet (that's the admin-manage-user function,
// not built in this pass), so there is deliberately no code path for it to reach here yet.
//
// Every reference that actually gets verified — success OR failure — is persisted to
// `payments`. The one thing deliberately NOT persisted is a reference that was never verified
// at all (e.g. Paystack's own API call errored before we got any definitive answer) — there's
// no real outcome to record for that, and a row claiming otherwise would mislead the admin
// transactions ledger rather than inform it.
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

  async function recordFailure(reason: string): Promise<never> {
    const row = {
      user_id: userId,
      provider: "paystack",
      provider_reference: reference,
      purpose: "department_access" as const,
      department_id: departmentId,
      // amount/currency reflect what Paystack actually reported, even on failure — the one
      // exception is a non-numeric amount (shouldn't happen, but never let a malformed value
      // violate the `amount > 0` check), which falls back to a nominal 1 rather than erroring
      // on the write itself.
      amount: paystack.data?.amount ? paystack.data.amount / 100 : 1,
      currency: paystack.data?.currency ?? "NGN",
      status: "failed" as const,
      verified_at: new Date().toISOString(),
      raw_provider_response: { ...paystack.data, _failure_reason: reason },
    };

    if (existing) {
      await db.from("payments").update(row).eq("id", existing.id);
    } else {
      await db.from("payments").insert(row);
    }
    throw new HttpError(402, reason);
  }

  if (!paystack.status || paystack.data.status !== "success") {
    await recordFailure("Payment was not successful.");
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
    await recordFailure("No price configured for this department/currency.");
    return; // unreachable — recordFailure always throws — but keeps TS's control-flow happy
  }

  const expectedKobo = Math.round(Number(priceRow.amount) * 100);
  if (paystack.data.amount !== expectedKobo) {
    await recordFailure(
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
    throw new HttpError(
      500,
      paymentRow.error?.message ?? "Failed to record payment.",
    );
  }

  const expiresAt = priceRow.access_duration_days
    ? new Date(
        Date.now() + priceRow.access_duration_days * 86_400_000,
      ).toISOString()
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

  await creditReferralCommission({
    db,
    paymentId: paymentRow.data.id,
    referredUserId: userId,
    baseAmount: Number(priceRow.amount),
    baseCurrency: paystack.data.currency,
  });

  return { alreadyProcessed: false };
}

// 25% of the base price, credited only when the buyer was referred by a currently-active
// affiliate (opt-in — see 03-BUSINESS-RULES-REDESIGN.md §1). The rate is hardcoded for now,
// same as the withdrawal minimums, pending an app_settings table. Silently a no-op when there's
// no referral or the referrer never activated — never blocks the payment itself.
async function creditReferralCommission({
  db,
  paymentId,
  referredUserId,
  baseAmount,
  baseCurrency,
}: {
  db: ReturnType<typeof serviceClient>;
  paymentId: string;
  referredUserId: string;
  baseAmount: number;
  baseCurrency: string;
}) {
  const COMMISSION_RATE = 0.25;

  const { data: referral } = await db
    .from("referrals")
    .select("referrer_user_id")
    .eq("referred_user_id", referredUserId)
    .maybeSingle();

  if (!referral) return;

  const { data: affiliate } = await db
    .from("affiliate_profiles")
    .select("status")
    .eq("user_id", referral.referrer_user_id)
    .maybeSingle();

  if (affiliate?.status !== "active") return;

  const commissionAmount = Math.round(baseAmount * COMMISSION_RATE * 100) / 100;

  // unique(payment_id) makes this safe against the same payment being processed twice
  // (webhook + client verify both landing) — the second insert just violates the constraint.
  await db.from("commissions").insert({
    payment_id: paymentId,
    referrer_user_id: referral.referrer_user_id,
    referred_user_id: referredUserId,
    base_amount: baseAmount,
    base_currency: baseCurrency,
    commission_rate: COMMISSION_RATE,
    commission_amount: commissionAmount,
    commission_currency: baseCurrency,
  });
}

// Admin-triggered: approves or rejects a pending withdrawal. Approval only auto-pays NGN
// bank_transfer withdrawals via Paystack's Transfer API — every other currency/method
// (PayPal, USDT, international wire) has no Paystack equivalent, so the admin settles those
// outside this function and records the result with a direct "mark as paid" update, which the
// existing withdrawals_staff_manage RLS policy already allows without going through here.
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  anonClient,
  serviceClient,
  verifyUser,
  HttpError,
} from "../_shared/supabaseClients.ts";
import {
  createTransferRecipient,
  initiateTransfer,
} from "../_shared/paystack.ts";
import { notify } from "../_shared/notify.ts";

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const admin = await verifyUser(req);

    const authHeader = req.headers.get("Authorization")!;
    const { data: isStaff } = await anonClient(authHeader).rpc(
      "is_moderator_or_admin",
    );
    if (!isStaff)
      throw new HttpError(403, "Admin or moderator access required.");

    const { withdrawal_id, action, reason } = await req.json();
    if (!withdrawal_id || !["approve", "reject"].includes(action)) {
      throw new HttpError(
        400,
        "withdrawal_id and action ('approve' | 'reject') are required.",
      );
    }

    const db = serviceClient();
    const { data: withdrawal, error: fetchError } = await db
      .from("withdrawals")
      .select(
        "id, user_id, amount, currency, status, payout_method_id, payout_methods(method, bank_code, account_number, account_name)",
      )
      .eq("id", withdrawal_id)
      .single();

    if (fetchError || !withdrawal)
      throw new HttpError(404, "Withdrawal not found.");
    if (withdrawal.status !== "pending") {
      throw new HttpError(409, `Withdrawal is already ${withdrawal.status}.`);
    }

    if (action === "reject") {
      await db
        .from("withdrawals")
        .update({
          status: "failed",
          provider_response: {
            manual: true,
            reason: reason ?? "Rejected by admin.",
          },
          processed_at: new Date().toISOString(),
          processed_by: admin.id,
        })
        .eq("id", withdrawal_id);
      await notify({
        db,
        userId: withdrawal.user_id,
        type: "withdrawal_processed",
        title: "Withdrawal rejected",
        body: `Your withdrawal of ${withdrawal.amount} ${withdrawal.currency} was rejected${reason ? `: ${reason}` : "."}`,
      });
      return jsonResponse({ success: true, status: "failed" });
    }

    const method = (withdrawal as { payout_methods: { method: string } | null })
      .payout_methods;
    if (withdrawal.currency !== "NGN" || method?.method !== "bank_transfer") {
      throw new HttpError(
        422,
        "Only NGN bank-transfer withdrawals can be auto-paid here — settle this one manually and record it with a direct status update.",
      );
    }

    const payoutMethod = method as unknown as {
      bank_code: string | null;
      account_number: string | null;
      account_name: string | null;
    };
    if (
      !payoutMethod.bank_code ||
      !payoutMethod.account_number ||
      !payoutMethod.account_name
    ) {
      throw new HttpError(422, "Payout method is missing bank details.");
    }

    const recipient = await createTransferRecipient({
      accountNumber: payoutMethod.account_number,
      bankCode: payoutMethod.bank_code,
      accountName: payoutMethod.account_name,
    });

    if (!recipient.status) {
      await db
        .from("withdrawals")
        .update({
          status: "failed",
          provider_response: { step: "create_recipient", ...recipient },
          processed_at: new Date().toISOString(),
          processed_by: admin.id,
        })
        .eq("id", withdrawal_id);
      await notify({
        db,
        userId: withdrawal.user_id,
        type: "withdrawal_processed",
        title: "Withdrawal failed",
        body: `Your withdrawal of ${withdrawal.amount} ${withdrawal.currency} failed: ${recipient.message}`,
      });
      throw new HttpError(
        502,
        `Paystack recipient creation failed: ${recipient.message}`,
      );
    }

    const transfer = await initiateTransfer({
      amountNaira: Number(withdrawal.amount),
      recipientCode: recipient.data.recipient_code,
      reason: "Affiliate commission payout",
    });

    const paid = transfer.status && transfer.data.status !== "failed";
    await db
      .from("withdrawals")
      .update({
        status: paid ? "success" : "failed",
        provider_reference: transfer.data?.transfer_code ?? null,
        provider_response: transfer,
        processed_at: new Date().toISOString(),
        processed_by: admin.id,
      })
      .eq("id", withdrawal_id);

    await notify({
      db,
      userId: withdrawal.user_id,
      type: "withdrawal_processed",
      title: paid ? "Withdrawal paid" : "Withdrawal failed",
      body: paid
        ? `Your withdrawal of ${withdrawal.amount} ${withdrawal.currency} was paid out.`
        : `Your withdrawal of ${withdrawal.amount} ${withdrawal.currency} failed: ${transfer.message}`,
    });

    if (!paid)
      throw new HttpError(502, `Paystack transfer failed: ${transfer.message}`);

    return jsonResponse({ success: true, status: "success" });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unexpected error.";
    return jsonResponse({ success: false, error: message }, status);
  }
});

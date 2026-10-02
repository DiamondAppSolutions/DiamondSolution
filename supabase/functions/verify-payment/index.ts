import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { verifyUser, HttpError } from "../_shared/supabaseClients.ts";
import { verifyPaystackTransaction } from "../_shared/paystack.ts";
import { processDepartmentAccessPayment } from "../_shared/processPayment.ts";

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await verifyUser(req);
    const { reference, department_id } = await req.json();

    if (!reference || !department_id) {
      throw new HttpError(400, "reference and department_id are required.");
    }

    const paystack = await verifyPaystackTransaction(reference);
    const result = await processDepartmentAccessPayment({
      reference,
      userId: user.id,
      departmentId: department_id,
      paystack,
    });

    return jsonResponse({ success: true, ...result });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unexpected error.";
    return jsonResponse({ success: false, error: message }, status);
  }
});

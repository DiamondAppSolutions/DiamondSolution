const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY");

export interface PaystackVerifyResult {
  status: boolean;
  data: {
    status: string; // "success" | "failed" | "abandoned" | ...
    reference: string;
    amount: number; // kobo/cents
    currency: string;
    metadata: Record<string, unknown>;
  };
}

export async function verifyPaystackTransaction(reference: string): Promise<PaystackVerifyResult> {
  if (!PAYSTACK_SECRET_KEY) {
    throw new Error(
      "PAYSTACK_SECRET_KEY is not configured — set it with `supabase secrets set PAYSTACK_SECRET_KEY=sk_...`",
    );
  }

  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
  });

  if (!res.ok) {
    throw new Error(`Paystack verify request failed with status ${res.status}`);
  }
  return res.json();
}

// Verifies the raw webhook body against Paystack's HMAC-SHA512 signature header.
// Never trust a webhook payload without this check — anyone could POST a fake "success" event.
export async function verifyPaystackSignature(rawBody: string, signatureHeader: string | null) {
  if (!PAYSTACK_SECRET_KEY || !signatureHeader) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(PAYSTACK_SECRET_KEY),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computed = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return computed === signatureHeader;
}

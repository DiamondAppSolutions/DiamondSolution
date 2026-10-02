import { useEffect, useState } from "react";
import { format } from "date-fns";
import { supabase } from "@/lib/supabase";
import { AdminLayout } from "@/components/AdminLayout";

interface PayoutMethod {
  method: string;
  bank_code: string | null;
  account_number: string | null;
  account_name: string | null;
}

interface Withdrawal {
  id: string;
  user_id: string;
  amount: number;
  currency: "NGN" | "USD";
  status: "pending" | "success" | "failed";
  provider_reference: string | null;
  provider_response: Record<string, unknown> | null;
  requested_at: string;
  processed_at: string | null;
  payout_methods: PayoutMethod | null;
}

type StatusFilter = "pending" | "success" | "failed" | "all";

export default function AdminWithdrawals() {
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data: rows } = await supabase
      .from("withdrawals")
      .select(
        "id, user_id, amount, currency, status, provider_reference, provider_response, requested_at, processed_at, payout_methods(method, bank_code, account_number, account_name)",
      )
      .order("requested_at", { ascending: false })
      .limit(200);

    setWithdrawals((rows as unknown as Withdrawal[]) ?? []);

    const userIds = [...new Set((rows ?? []).map((r) => r.user_id))];
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", userIds);
      setNames(
        Object.fromEntries(
          (profiles ?? []).map((p) => [p.user_id, p.display_name ?? "Unnamed"]),
        ),
      );
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function approve(id: string) {
    setBusyId(id);
    setError(null);
    const { data, error: invokeError } = await supabase.functions.invoke(
      "request-payout",
      {
        body: { withdrawal_id: id, action: "approve" },
      },
    );
    setBusyId(null);
    if (invokeError || !data?.success) {
      setError(
        `Payout failed: ${invokeError?.message ?? data?.error ?? "unknown error"} — withdrawal marked failed, settle manually if needed.`,
      );
    }
    void load();
  }

  async function reject(id: string) {
    const reason = window.prompt("Reason for rejecting this withdrawal?") ?? "";
    setBusyId(id);
    setError(null);
    const { data, error: invokeError } = await supabase.functions.invoke(
      "request-payout",
      {
        body: { withdrawal_id: id, action: "reject", reason },
      },
    );
    setBusyId(null);
    if (invokeError || !data?.success) {
      setError(
        `Reject failed: ${invokeError?.message ?? data?.error ?? "unknown error"}`,
      );
    }
    void load();
  }

  async function markPaidManually(id: string) {
    const reference = window.prompt(
      "External payment reference (e.g. PayPal/USDT txn id)?",
    );
    if (!reference) return;
    setBusyId(id);
    setError(null);
    const { error: updateError } = await supabase
      .from("withdrawals")
      .update({
        status: "success",
        provider_reference: reference,
        provider_response: { manual: true },
        processed_at: new Date().toISOString(),
      })
      .eq("id", id);
    setBusyId(null);
    if (updateError) setError(updateError.message);
    void load();
  }

  const filtered = withdrawals.filter(
    (w) => status === "all" || w.status === status,
  );

  const statusStyle: Record<string, string> = {
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    failed: "bg-rose-50 text-rose-700 border-rose-200",
    pending: "bg-amber-50 text-amber-700 border-amber-200",
  };

  return (
    <AdminLayout>
      <h1 className="font-heading text-2xl font-bold text-text-1">
        Withdrawals
      </h1>

      <div className="mt-4 flex flex-wrap gap-2">
        {(["pending", "success", "failed", "all"] as StatusFilter[]).map(
          (s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-xl px-3 py-1.5 text-sm font-semibold capitalize ${
                status === s
                  ? "bg-royal text-white"
                  : "bg-canvas-soft text-text-2"
              }`}
            >
              {s}
            </button>
          ),
        )}
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      <div className="mt-4 space-y-3">
        {loading ? (
          <p className="text-sm text-text-3">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-text-3">No withdrawals match.</p>
        ) : (
          filtered.map((w) => {
            const canAutoPay =
              w.currency === "NGN" &&
              w.payout_methods?.method === "bank_transfer";
            return (
              <div key={w.id} className="card-luxury p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-text-1">
                      {names[w.user_id] ?? "Unknown"}
                    </p>
                    <p className="text-xs text-text-3">
                      {w.payout_methods?.method ?? "—"} ·{" "}
                      {w.payout_methods?.account_number ?? "no account on file"}
                    </p>
                    <p className="mt-1 text-xs text-text-3">
                      Requested{" "}
                      {format(new Date(w.requested_at), "yyyy-MM-dd HH:mm")}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold text-text-1">
                      {w.currency === "NGN" ? "₦" : "$"}
                      {Number(w.amount).toLocaleString()}
                    </p>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${statusStyle[w.status]}`}
                    >
                      {w.status}
                    </span>
                  </div>
                </div>

                {w.status === "pending" && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-canvas-border pt-3">
                    {canAutoPay && (
                      <button
                        onClick={() => void approve(w.id)}
                        disabled={busyId === w.id}
                        className="btn-primary px-3 py-1.5 text-xs"
                      >
                        {busyId === w.id ? "Paying…" : "Pay via Paystack"}
                      </button>
                    )}
                    <button
                      onClick={() => void markPaidManually(w.id)}
                      disabled={busyId === w.id}
                      className="btn-secondary px-3 py-1.5 text-xs"
                    >
                      Mark as paid manually
                    </button>
                    <button
                      onClick={() => void reject(w.id)}
                      disabled={busyId === w.id}
                      className="btn-outline px-3 py-1.5 text-xs text-rose-600"
                    >
                      Reject
                    </button>
                  </div>
                )}

                {w.status === "failed" &&
                  (w.provider_response?.reason ||
                    w.provider_response?.message) !== undefined && (
                    <p className="mt-2 text-xs font-semibold text-rose-600">
                      {String(
                        w.provider_response?.reason ??
                          w.provider_response?.message,
                      )}
                    </p>
                  )}
              </div>
            );
          })
        )}
      </div>
    </AdminLayout>
  );
}

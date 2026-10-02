import { useEffect, useState } from "react";
import { format } from "date-fns";
import { supabase } from "@/lib/supabase";
import { AdminLayout } from "@/components/AdminLayout";
import { downloadCSV } from "@/lib/csv";

interface Payment {
  id: string;
  user_id: string;
  provider: string;
  provider_reference: string;
  department_id: string | null;
  amount: number;
  currency: string;
  status: "pending" | "success" | "failed";
  created_at: string;
  verified_at: string | null;
  raw_provider_response: Record<string, unknown> | null;
}

type StatusFilter = "all" | "success" | "failed" | "pending";

export default function AdminPayments() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [departmentNames, setDepartmentNames] = useState<
    Record<string, string>
  >({});
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data: paymentRows } = await supabase
        .from("payments")
        .select(
          "id, user_id, provider, provider_reference, department_id, amount, currency, status, created_at, verified_at, raw_provider_response",
        )
        .order("created_at", { ascending: false })
        .limit(500);

      setPayments(paymentRows ?? []);

      const userIds = [...new Set((paymentRows ?? []).map((p) => p.user_id))];
      const deptIds = [
        ...new Set(
          (paymentRows ?? []).map((p) => p.department_id).filter(Boolean),
        ),
      ] as string[];

      const [{ data: profiles }, { data: depts }] = await Promise.all([
        userIds.length > 0
          ? supabase
              .from("profiles")
              .select("user_id, display_name")
              .in("user_id", userIds)
          : Promise.resolve({ data: [] }),
        deptIds.length > 0
          ? supabase.from("departments").select("id, name").in("id", deptIds)
          : Promise.resolve({ data: [] }),
      ]);

      setProfileNames(
        Object.fromEntries(
          (profiles ?? []).map((p) => [p.user_id, p.display_name ?? "Unnamed"]),
        ),
      );
      setDepartmentNames(
        Object.fromEntries((depts ?? []).map((d) => [d.id, d.name])),
      );
      setLoading(false);
    }
    void load();
  }, []);

  const filtered = payments.filter((p) => {
    if (status !== "all" && p.status !== status) return false;
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      p.provider_reference.toLowerCase().includes(term) ||
      (profileNames[p.user_id] ?? "").toLowerCase().includes(term) ||
      (p.department_id &&
        (departmentNames[p.department_id] ?? "").toLowerCase().includes(term))
    );
  });

  const statusStyle: Record<string, string> = {
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    failed: "bg-rose-50 text-rose-700 border-rose-200",
    pending: "bg-amber-50 text-amber-700 border-amber-200",
  };

  function handleExport() {
    const headers = [
      "Reference",
      "Payer",
      "Department",
      "Amount",
      "Currency",
      "Status",
      "Date",
    ];
    const rows = filtered.map((p) => [
      p.provider_reference,
      profileNames[p.user_id] ?? "",
      p.department_id ? (departmentNames[p.department_id] ?? "") : "",
      String(p.amount),
      p.currency,
      p.status,
      format(new Date(p.created_at), "yyyy-MM-dd HH:mm"),
    ]);
    downloadCSV("financial_ledger.csv", [headers, ...rows]);
  }

  return (
    <AdminLayout>
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-bold text-text-1">
          Transactions
        </h1>
        <button onClick={handleExport} className="btn-outline text-sm">
          Export CSV
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {(["all", "success", "failed", "pending"] as StatusFilter[]).map(
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
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search reference, payer, department…"
          className="ml-auto min-w-[220px] rounded-xl border border-canvas-border bg-white px-3 py-1.5 text-sm focus:border-royal focus:outline-none"
        />
      </div>

      <div className="mt-4 space-y-2">
        {loading ? (
          <p className="text-sm text-text-3">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-text-3">No transactions match.</p>
        ) : (
          filtered.map((p) => {
            const isOpen = expanded === p.id;
            const failureReason =
              p.status === "failed"
                ? (p.raw_provider_response?._failure_reason as
                    string | undefined)
                : undefined;
            return (
              <div key={p.id} className="card-luxury p-4">
                <button
                  onClick={() => setExpanded(isOpen ? null : p.id)}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-text-1">
                      {profileNames[p.user_id] ?? "Unknown"}
                      {p.department_id && (
                        <span className="font-normal text-text-3">
                          {" "}
                          · {departmentNames[p.department_id]}
                        </span>
                      )}
                    </p>
                    <p className="font-mono text-xs text-text-3">
                      {p.provider_reference}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold text-text-1">
                      {p.currency === "NGN" ? "₦" : "$"}
                      {Number(p.amount).toLocaleString()}
                    </p>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${statusStyle[p.status]}`}
                    >
                      {p.status}
                    </span>
                  </div>
                </button>
                {isOpen && (
                  <div className="mt-3 border-t border-canvas-border pt-3 text-xs text-text-3">
                    <p>
                      Created:{" "}
                      {format(new Date(p.created_at), "yyyy-MM-dd HH:mm:ss")}
                    </p>
                    {p.verified_at && (
                      <p>
                        Verified:{" "}
                        {format(new Date(p.verified_at), "yyyy-MM-dd HH:mm:ss")}
                      </p>
                    )}
                    {failureReason && (
                      <p className="mt-1 font-semibold text-rose-600">
                        Reason: {failureReason}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </AdminLayout>
  );
}

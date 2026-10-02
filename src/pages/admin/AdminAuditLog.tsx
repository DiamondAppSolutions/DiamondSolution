import { useEffect, useState } from "react";
import { format } from "date-fns";
import { supabase } from "@/lib/supabase";
import { AdminLayout } from "@/components/AdminLayout";

interface LogRow {
  id: string;
  actor_user_id: string;
  action: string;
  target_table: string | null;
  target_id: string | null;
  reason: string | null;
  created_at: string;
}

export default function AdminAuditLog() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from("admin_actions_log")
        .select(
          "id, actor_user_id, action, target_table, target_id, reason, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      setRows(data ?? []);

      const actorIds = [...new Set((data ?? []).map((r) => r.actor_user_id))];
      if (actorIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", actorIds);
        setNames(
          Object.fromEntries(
            (profiles ?? []).map((p) => [
              p.user_id,
              p.display_name ?? "Unknown",
            ]),
          ),
        );
      }
      setLoading(false);
    }
    void load();
  }, []);

  return (
    <AdminLayout>
      <h1 className="font-heading text-2xl font-bold text-text-1">Audit Log</h1>
      <p className="mt-1 text-sm text-text-3">
        Every withdrawal-affecting admin action, who did it, and when. Full OTP
        step-up confirmation for destructive admin actions is a Phase 5 item
        pending an email-provider decision — this is the audit trail half, live
        today.
      </p>

      <div className="mt-4 space-y-2">
        {loading ? (
          <p className="text-sm text-text-3">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-text-3">No admin actions logged yet.</p>
        ) : (
          rows.map((r) => (
            <div key={r.id} className="card-luxury p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-text-1">
                  {names[r.actor_user_id] ?? "Unknown"}{" "}
                  <span className="font-normal text-text-3">
                    — {r.action.replace(/_/g, " ")}
                  </span>
                </p>
                <p className="text-xs text-text-3">
                  {format(new Date(r.created_at), "yyyy-MM-dd HH:mm:ss")}
                </p>
              </div>
              {r.target_table && (
                <p className="mt-1 font-mono text-xs text-text-3">
                  {r.target_table}:{r.target_id}
                </p>
              )}
              {r.reason && (
                <p className="mt-1 text-xs text-text-2">{r.reason}</p>
              )}
            </div>
          ))
        )}
      </div>
    </AdminLayout>
  );
}

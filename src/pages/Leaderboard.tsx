import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { startOfWeek, endOfWeek, format } from "date-fns";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { Layout } from "@/components/Layout";

type Range = "week" | "all";

interface Row {
  user_id: string;
  attempted: number;
  correct: number;
  points: number;
  accuracy: number;
  display_name: string;
  university: string;
}

interface Department {
  id: string;
  name: string;
}

export default function Leaderboard() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>("week");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("departments")
      .select("id, name")
      .eq("status", "active")
      .order("name")
      .then(({ data }) => setDepartments(data ?? []));
  }, []);

  useEffect(() => {
    if (profile?.department_id && !departmentId)
      setDepartmentId(profile.department_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const today = new Date();
      const from =
        range === "week"
          ? startOfWeek(today, { weekStartsOn: 1 })
          : new Date("2000-01-01");
      const to =
        range === "week" ? endOfWeek(today, { weekStartsOn: 1 }) : today;

      const { data: standings } = await supabase.rpc("leaderboard", {
        p_from: format(from, "yyyy-MM-dd"),
        p_to: format(to, "yyyy-MM-dd"),
        p_department_id: departmentId || null,
        p_limit: 50,
      });

      const userIds = (standings ?? []).map(
        (s: { user_id: string }) => s.user_id,
      );
      const { data: names } =
        userIds.length > 0
          ? await supabase.rpc("public_profile_names", { p_user_ids: userIds })
          : { data: [] };

      const nameMap = new Map((names ?? []).map((n: Row) => [n.user_id, n]));

      setRows(
        (standings ?? []).map(
          (s: { user_id: string; attempted: number; correct: number }) => {
            const name = nameMap.get(s.user_id);
            return {
              user_id: s.user_id,
              attempted: s.attempted,
              correct: s.correct,
              points: Math.round((s.attempted * 2 + s.correct * 0.5) * 10) / 10,
              accuracy:
                s.attempted > 0
                  ? Math.round((s.correct / s.attempted) * 100)
                  : 0,
              display_name:
                (name as { display_name?: string })?.display_name ??
                (user?.id === s.user_id ? "You" : "Scholar"),
              university: (name as { university?: string })?.university ?? "",
            };
          },
        ),
      );
      setLoading(false);
    }
    void load();
  }, [range, departmentId, user]);

  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3);
  const rankStyle = [
    "bg-gold text-navy",
    "bg-slate-300 text-navy",
    "bg-amber-700 text-white",
  ];

  return (
    <Layout title="Leaderboard" onBack={() => navigate("/dashboard")}>
      <div className="mb-4 flex gap-2">
        {(["week", "all"] as Range[]).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`rounded-xl px-3 py-1.5 text-sm font-semibold ${
              range === r ? "bg-royal text-white" : "bg-canvas-soft text-text-2"
            }`}
          >
            {r === "week" ? "This week" : "All time"}
          </button>
        ))}
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto">
        <button
          onClick={() => setDepartmentId("")}
          className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold ${
            !departmentId ? "bg-navy text-white" : "bg-canvas-soft text-text-2"
          }`}
        >
          All departments
        </button>
        {departments.map((d) => (
          <button
            key={d.id}
            onClick={() => setDepartmentId(d.id)}
            className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold ${
              departmentId === d.id
                ? "bg-navy text-white"
                : "bg-canvas-soft text-text-2"
            }`}
          >
            {d.name}
          </button>
        ))}
      </div>

      <p className="mb-4 text-xs text-text-3">
        Formula: (Attempts × 2) + (Correct × 0.5)
      </p>

      {loading ? (
        <p className="text-sm text-text-3">Calculating standings…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-3">No rankings recorded yet.</p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-2">
            {top3.map((r, i) => (
              <div key={r.user_id} className="card-luxury p-3 text-center">
                <span
                  className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${rankStyle[i]}`}
                >
                  {i + 1}
                </span>
                <p className="mt-2 truncate font-heading text-sm font-bold text-text-1">
                  {r.display_name}
                </p>
                <p className="truncate text-xs text-text-3">{r.university}</p>
                <p className="mt-1 text-sm font-bold text-royal">
                  {r.points} pts
                </p>
                <p className="text-xs text-text-3">{r.accuracy}% accuracy</p>
              </div>
            ))}
          </div>

          <div className="space-y-1">
            {rest.map((r, i) => (
              <div
                key={r.user_id}
                className="flex items-center justify-between rounded-xl px-3 py-2 odd:bg-canvas-soft/60"
              >
                <div className="flex items-center gap-3">
                  <span className="w-5 text-sm font-semibold text-text-3">
                    {i + 4}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-text-1">
                      {r.display_name}
                    </p>
                    <p className="text-xs text-text-3">
                      {r.correct} correct of {r.attempted}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-royal">{r.points} pts</p>
                  <p className="text-xs text-text-3">{r.accuracy}%</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Layout>
  );
}

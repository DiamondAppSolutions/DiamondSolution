import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { Layout } from "@/components/Layout";

type Filter = "all" | "correct" | "incorrect" | "skipped";
const PAGE_SIZE = 20;

interface OptionRow {
  id: string;
  label: string;
  body: string;
  is_correct: boolean;
}
interface AttemptRow {
  id: string;
  result: "correct" | "incorrect" | "skipped" | "applied";
  attempted_at: string;
  selected_option_id: string | null;
  questions: {
    prompt: string;
    type: "objective" | "application";
    explanation: string | null;
    expected_answer: string | null;
    courses: { title: string } | null;
    question_options: OptionRow[];
  } | null;
}

export default function ActivityLog() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);

  async function loadPage(pageIndex: number) {
    if (!user) return;
    setLoading(true);
    const from = pageIndex * PAGE_SIZE;
    const { data } = await supabase
      .from("question_attempts")
      .select(
        `id, result, attempted_at, selected_option_id,
         questions ( prompt, type, explanation, expected_answer,
           courses ( title ),
           question_options ( id, label, body, is_correct ) )`,
      )
      .eq("user_id", user.id)
      .order("attempted_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    const rows = (data ?? []) as unknown as AttemptRow[];
    setAttempts((prev) => (pageIndex === 0 ? rows : [...prev, ...rows]));
    setHasMore(rows.length === PAGE_SIZE);
    setLoading(false);
  }

  useEffect(() => {
    void loadPage(0);
    setPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const filtered = attempts.filter((a) => {
    if (filter === "all") return true;
    if (filter === "correct")
      return a.result === "correct" || a.result === "applied";
    return a.result === filter;
  });

  const resultBadge: Record<string, string> = {
    correct: "text-emerald-600",
    applied: "text-emerald-600",
    incorrect: "text-rose-600",
    skipped: "text-amber-600",
  };

  return (
    <Layout title="Revision Center" onBack={() => navigate("/dashboard")}>
      <div className="mb-4 flex gap-2 overflow-x-auto">
        {(["all", "correct", "incorrect", "skipped"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`shrink-0 rounded-xl px-3 py-1.5 text-sm font-semibold capitalize transition-colors ${
              filter === f
                ? "bg-royal text-white"
                : "bg-canvas-soft text-text-2"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {loading && attempts.length === 0 ? (
        <p className="text-sm text-text-3">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-text-3">
          No activity yet — start studying to see it here.
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((a) => {
            const q = a.questions;
            const isOpen = expanded === a.id;
            return (
              <div key={a.id} className="card-luxury p-4">
                <button
                  onClick={() => setExpanded(isOpen ? null : a.id)}
                  className="flex w-full items-start justify-between gap-3 text-left"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-text-3">
                      {q?.courses?.title} ·{" "}
                      {format(new Date(a.attempted_at), "MMM d, HH:mm")}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm text-text-1">
                      {q?.prompt}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-xs font-bold capitalize ${resultBadge[a.result]}`}
                  >
                    {a.result}
                  </span>
                </button>

                {isOpen && q && (
                  <div className="mt-3 border-t border-canvas-border pt-3">
                    {q.type === "application" ? (
                      <div className="rounded-xl bg-navy p-3 text-sm text-white">
                        <p className="font-semibold">Expected answer</p>
                        <p className="mt-1 text-white/90">
                          {q.expected_answer || "No expected answer recorded."}
                        </p>
                      </div>
                    ) : (
                      <ul className="space-y-1 text-sm">
                        {q.question_options.map((o) => (
                          <li
                            key={o.id}
                            className={
                              o.is_correct
                                ? "font-semibold text-emerald-700"
                                : o.id === a.selected_option_id
                                  ? "font-semibold text-rose-700"
                                  : "text-text-3"
                            }
                          >
                            {o.label}. {o.body}
                            {o.is_correct && " — Correct"}
                            {!o.is_correct &&
                              o.id === a.selected_option_id &&
                              " — Your choice"}
                          </li>
                        ))}
                      </ul>
                    )}
                    {q.explanation && (
                      <div className="mt-3 rounded-xl bg-canvas-soft p-3 text-sm text-text-2">
                        {q.explanation}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {hasMore && filtered.length > 0 && (
        <button
          onClick={() => {
            const next = page + 1;
            setPage(next);
            void loadPage(next);
          }}
          disabled={loading}
          className="btn-outline mt-4 w-full"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </Layout>
  );
}

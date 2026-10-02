import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, subDays } from "date-fns";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { Layout } from "@/components/Layout";

interface Department {
  id: string;
  name: string;
}
interface DayStat {
  date: string;
  attempted: number;
  correct: number;
  studyDuration: number;
}
interface ResumeCourse {
  course_id: string;
  current_order: number;
  course_title: string;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function Dashboard() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [points, setPoints] = useState(0);
  const [accuracy, setAccuracy] = useState(0);
  const [attempted, setAttempted] = useState(0);
  const [week, setWeek] = useState<DayStat[]>([]);
  const [resume, setResume] = useState<ResumeCourse | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [grantedIds, setGrantedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!user) return;
      setLoading(true);

      const [
        { data: allStats },
        { data: progressRows },
        { data: depts },
        { data: grants },
      ] = await Promise.all([
        supabase
          .from("daily_practice_stats")
          .select("practice_date, attempted, correct, study_duration_seconds")
          .eq("user_id", user.id),
        supabase
          .from("study_progress")
          .select(
            "course_id, current_order, updated_at, completed, courses(title)",
          )
          .eq("user_id", user.id)
          .eq("completed", false)
          .order("updated_at", { ascending: false })
          .limit(1),
        supabase
          .from("departments")
          .select("id, name")
          .eq("status", "active")
          .order("name"),
        supabase
          .from("access_grants")
          .select("department_id")
          .eq("user_id", user.id),
      ]);

      const totalAttempted = (allStats ?? []).reduce(
        (s, r) => s + r.attempted,
        0,
      );
      const totalCorrect = (allStats ?? []).reduce((s, r) => s + r.correct, 0);
      setAttempted(totalAttempted);
      setPoints(
        Math.round((totalAttempted * 2 + totalCorrect * 0.5) * 10) / 10,
      );
      setAccuracy(
        totalAttempted > 0
          ? Math.round((totalCorrect / totalAttempted) * 100)
          : 0,
      );

      const byDate = new Map((allStats ?? []).map((r) => [r.practice_date, r]));
      const days: DayStat[] = Array.from({ length: 7 }, (_, i) => {
        const date = format(subDays(new Date(), 6 - i), "yyyy-MM-dd");
        const row = byDate.get(date);
        return {
          date,
          attempted: row?.attempted ?? 0,
          correct: row?.correct ?? 0,
          studyDuration: row?.study_duration_seconds ?? 0,
        };
      });
      setWeek(days);

      const progress = progressRows?.[0] as
        | {
            course_id: string;
            current_order: number;
            courses: { title: string } | null;
          }
        | undefined;
      setResume(
        progress
          ? {
              course_id: progress.course_id,
              current_order: progress.current_order,
              course_title: progress.courses?.title ?? "",
            }
          : null,
      );

      setDepartments(depts ?? []);
      setGrantedIds(new Set((grants ?? []).map((g) => g.department_id)));
      setLoading(false);
    }
    void load();
  }, [user]);

  const maxAttempted = Math.max(1, ...week.map((d) => d.attempted));

  return (
    <Layout title="Dashboard">
      <p className="text-sm text-text-3">
        {greeting()},{" "}
        <span className="font-semibold text-text-1">
          {profile?.display_name ?? user?.email}
        </span>
      </p>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="Points" value={points} />
        <Stat label="Accuracy" value={`${accuracy}%`} />
        <Stat label="Attempted" value={attempted} />
      </div>

      {!loading && resume && (
        <button
          onClick={() => navigate(`/courses/${resume.course_id}`)}
          className="diamond-gradient card-luxury mt-4 w-full p-5 text-left text-white"
        >
          <p className="text-xs uppercase tracking-wide text-white/70">
            Continue studying
          </p>
          <p className="mt-1 font-heading text-lg font-bold">
            {resume.course_title}
          </p>
          <p className="mt-1 text-sm text-white/80">
            Question {resume.current_order + 1} →
          </p>
        </button>
      )}

      <div className="card-luxury mt-4 p-5">
        <h2 className="font-heading text-sm font-bold text-text-1">
          Last 7 days
        </h2>
        <div className="mt-3 flex items-end gap-2" style={{ height: 80 }}>
          {week.map((d) => (
            <div
              key={d.date}
              className="flex flex-1 flex-col items-center gap-1"
            >
              <div
                className="w-full rounded-t bg-royal"
                style={{
                  height: `${Math.max(4, (d.attempted / maxAttempted) * 64)}px`,
                }}
                title={`${d.attempted} attempted, ${d.correct} correct`}
              />
              <span className="text-[10px] text-text-3">
                {format(new Date(d.date), "EEE")}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2">
        <QuickAction label="Study" onClick={() => navigate("/courses")} />
        <QuickAction
          label="Leaderboard"
          onClick={() => navigate("/leaderboard")}
        />
        <QuickAction
          label="Activity"
          onClick={() => navigate("/activity-log")}
        />
        <QuickAction label="Affiliate" onClick={() => navigate("/affiliate")} />
      </div>

      <div className="mt-6">
        <h2 className="font-heading text-sm font-bold text-text-1">
          Departments
        </h2>
        <div className="mt-2 flex gap-3 overflow-x-auto pb-2">
          {departments.map((d) => (
            <button
              key={d.id}
              onClick={() => navigate(`/courses?department=${d.id}`)}
              className="card-luxury flex w-32 shrink-0 flex-col items-start p-3 text-left"
            >
              <span className="font-heading text-sm font-bold text-text-1">
                {d.name}
              </span>
              {grantedIds.has(d.id) && (
                <span className="badge-royal mt-2">Active</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </Layout>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card-luxury p-3 text-center">
      <p className="font-heading text-lg font-bold text-royal">{value}</p>
      <p className="text-xs text-text-3">{label}</p>
    </div>
  );
}

function QuickAction({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="btn-secondary py-3 text-xs">
      {label}
    </button>
  );
}

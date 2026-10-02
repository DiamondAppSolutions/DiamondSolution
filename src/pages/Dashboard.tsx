import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, subDays, startOfWeek, endOfWeek } from "date-fns";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { Layout } from "@/components/Layout";
import { DiamondLogo } from "@/components/DiamondLogo";

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
  totalQuestions: number;
}
interface TopRanker {
  user_id: string;
  display_name: string;
  points: number;
  accuracy: number;
  attempted: number;
}

const QUOTES = [
  "The secret of getting ahead is getting started. Master your clinical questions one day at a time.",
  "Discipline beats motivation when exam day actually arrives.",
  "Every question you attempt today is a patient you'll serve with more confidence tomorrow.",
  "Consistency compounds — a little practice daily outperforms a single long session.",
  "Review your misses as closely as your wins; that's where the real learning is.",
];

function quoteOfTheDay() {
  const start = new Date(new Date().getFullYear(), 0, 0);
  const dayOfYear = Math.floor((Date.now() - start.getTime()) / 86_400_000);
  return QUOTES[dayOfYear % QUOTES.length];
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
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [topRanker, setTopRanker] = useState<TopRanker | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!user) return;
      setLoading(true);

      const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
      const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });

      const [
        { data: allStats },
        { data: progressRows },
        { data: depts },
        { data: grants },
        { data: affiliateRow },
        { data: standings },
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
        supabase
          .from("affiliate_profiles")
          .select("referral_code")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase.rpc("leaderboard", {
          p_from: format(weekStart, "yyyy-MM-dd"),
          p_to: format(weekEnd, "yyyy-MM-dd"),
          p_department_id: profile?.department_id ?? null,
          p_limit: 1,
        }),
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

      if (progress) {
        const { count } = await supabase
          .from("questions")
          .select("id", { count: "exact", head: true })
          .eq("course_id", progress.course_id)
          .eq("status", "active");
        setResume({
          course_id: progress.course_id,
          current_order: progress.current_order,
          course_title: progress.courses?.title ?? "",
          totalQuestions: count ?? 0,
        });
      } else {
        setResume(null);
      }

      setDepartments(depts ?? []);
      setGrantedIds(new Set((grants ?? []).map((g) => g.department_id)));
      setReferralCode(affiliateRow?.referral_code ?? null);

      const top = (standings ?? [])[0] as
        { user_id: string; attempted: number; correct: number } | undefined;
      if (top) {
        const { data: names } = await supabase.rpc("public_profile_names", {
          p_user_ids: [top.user_id],
        });
        const name = (names ?? [])[0] as { display_name?: string } | undefined;
        setTopRanker({
          user_id: top.user_id,
          display_name: name?.display_name ?? "Scholar",
          points: Math.round((top.attempted * 2 + top.correct * 0.5) * 10) / 10,
          accuracy:
            top.attempted > 0
              ? Math.round((top.correct / top.attempted) * 100)
              : 0,
          attempted: top.attempted,
        });
      } else {
        setTopRanker(null);
      }

      setLoading(false);
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profile?.department_id]);

  const maxAttempted = Math.max(1, ...week.map((d) => d.attempted));
  const weekTimeSpentMinutes = Math.round(
    week.reduce((s, d) => s + d.studyDuration, 0) / 60,
  );
  const weekAttempted = week.reduce((s, d) => s + d.attempted, 0);
  const weekCorrect = week.reduce((s, d) => s + d.correct, 0);
  const weekAccuracy =
    weekAttempted > 0 ? Math.round((weekCorrect / weekAttempted) * 100) : 0;
  const resumePercent =
    resume && resume.totalQuestions > 0
      ? Math.round((resume.current_order / resume.totalQuestions) * 100)
      : 0;

  return (
    <Layout title="Dashboard">
      <div className="diamond-gradient card-luxury p-5 text-white">
        <div className="flex items-center gap-2">
          <DiamondLogo size={22} variant="white" layout="icon" />
          <span className="font-heading text-sm font-bold">
            Diamond Solution
          </span>
        </div>
        <p className="mt-3 text-xs text-white/70">{greeting()},</p>
        <p className="font-heading text-xl font-bold">
          {profile?.display_name ?? user?.email}
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <HeroStat label="Points" value={points} />
          <HeroStat label="Accuracy" value={`${accuracy}%`} />
          <HeroStat label="Attempted" value={attempted} />
        </div>
      </div>

      <div className="card-luxury mt-4 p-5">
        <p className="text-xs font-bold uppercase tracking-wide text-gold">
          Wisdom of the day
        </p>
        <p className="mt-2 text-sm italic text-text-2">"{quoteOfTheDay()}"</p>
        <p className="mt-1 text-xs text-text-3">— Diamond Solution Academy</p>
      </div>

      {!loading && resume && (
        <button
          onClick={() => navigate(`/courses/${resume.course_id}`)}
          className="diamond-gradient card-luxury mt-4 flex w-full items-center gap-4 p-5 text-left text-white"
        >
          <ProgressRing percent={resumePercent} />
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wide text-white/70">
              Recently practiced
            </p>
            <p className="mt-1 truncate font-heading text-base font-bold">
              {resume.course_title}
            </p>
            <p className="mt-1 text-xs text-white/80">
              {resume.current_order} of {resume.totalQuestions} questions
              completed
            </p>
            <span className="mt-2 inline-block rounded-full bg-gold px-3 py-1 text-xs font-bold text-navy">
              Resume quiz →
            </span>
          </div>
        </button>
      )}

      <div className="mt-6">
        <h2 className="font-heading text-sm font-bold text-text-1">
          Study analytics
        </h2>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Stat label="Time spent (7d)" value={`${weekTimeSpentMinutes}m`} />
          <Stat label="Attempted (7d)" value={weekAttempted} />
          <Stat label="Correct answers" value={weekCorrect} />
          <Stat label="Average score" value={`${weekAccuracy}%`} />
        </div>
      </div>

      <div className="card-luxury mt-4 p-5">
        <h2 className="font-heading text-sm font-bold text-text-1">
          Daily time spent &amp; practice volume
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
        <div className="mt-3 grid grid-cols-7 gap-1">
          {week.map((d) => (
            <div
              key={d.date}
              className="rounded-lg bg-canvas-soft py-1.5 text-center"
            >
              <p className="text-[10px] font-semibold text-text-2">
                {Math.round(d.studyDuration / 60)}m
              </p>
              <p className="text-[10px] text-text-3">{d.attempted}q</p>
            </div>
          ))}
        </div>
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

      <div className="mt-6 grid grid-cols-4 gap-2">
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

      <button
        onClick={() => navigate("/affiliate")}
        className="diamond-gradient card-luxury mt-4 w-full p-5 text-left text-white"
      >
        <p className="text-xs font-bold uppercase tracking-wide text-gold">
          Revenue program
        </p>
        <p className="mt-1 font-heading text-xl font-bold">
          Refer &amp; earn 25%
        </p>
        <p className="mt-1 text-sm text-white/80">
          Share your referral code and earn on every successful enrollment.
        </p>
        <span className="mt-3 inline-block rounded-full border border-white/30 bg-white/10 px-4 py-2 font-mono text-sm tracking-wider text-gold">
          {referralCode ?? "Become an affiliate →"}
        </span>
      </button>

      {topRanker && (
        <div className="card-luxury mt-4 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-sm font-bold text-text-1">
              Top this week
            </h2>
            <button
              onClick={() => navigate("/leaderboard")}
              className="text-xs font-semibold text-royal hover:underline"
            >
              See full rankings →
            </button>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <span className="badge-gold flex h-8 w-8 items-center justify-center rounded-full font-bold">
              1
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-text-1">
                {topRanker.user_id === user?.id
                  ? "You"
                  : topRanker.display_name}
              </p>
              <p className="text-xs text-text-3">
                {topRanker.accuracy}% accuracy · {topRanker.attempted} q's
              </p>
            </div>
            <span className="font-heading text-sm font-bold text-royal">
              {topRanker.points} pts
            </span>
          </div>
        </div>
      )}
    </Layout>
  );
}

function HeroStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-white/10 p-2 text-center">
      <p className="font-heading text-base font-bold">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-white/70">
        {label}
      </p>
    </div>
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

function ProgressRing({ percent }: { percent: number }) {
  const r = 20;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - percent / 100);
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" className="shrink-0">
      <circle
        cx="26"
        cy="26"
        r={r}
        fill="none"
        stroke="rgba(255,255,255,0.25)"
        strokeWidth="5"
      />
      <circle
        cx="26"
        cy="26"
        r={r}
        fill="none"
        stroke="#D4AF37"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 26 26)"
      />
      <text
        x="26"
        y="30"
        textAnchor="middle"
        className="fill-white text-[11px] font-bold"
      >
        {percent}%
      </text>
    </svg>
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

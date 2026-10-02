import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { Layout } from "@/components/Layout";

type QuestionType = "objective" | "application";
type Result = "correct" | "incorrect" | "skipped" | "applied";

interface Option {
  id: string;
  label: string;
  body: string;
  is_correct: boolean;
}
interface Question {
  id: string;
  type: QuestionType;
  prompt: string;
  expected_answer: string | null;
  explanation: string | null;
  options: Option[];
}
interface OutlineSection {
  title: string;
  start_question_order: number;
  end_question_order: number;
}

const OBJECTIVE_SECONDS = 60;
const APPLICATION_SECONDS = 120;

export default function StudyPage() {
  const { id: courseId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [courseTitle, setCourseTitle] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [outline, setOutline] = useState<OutlineSection[]>([]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [sessionResults, setSessionResults] = useState<Record<string, Result>>(
    {},
  );
  const [showResults, setShowResults] = useState(false);
  const [sectionComplete, setSectionComplete] = useState<OutlineSection | null>(
    null,
  );

  const [secondsLeft, setSecondsLeft] = useState(OBJECTIVE_SECONDS);
  const questionStartRef = useRef(Date.now());

  const question = questions[currentIndex];
  const totalSubmitted = Object.keys(sessionResults).length;
  const totalCorrect = Object.values(sessionResults).filter(
    (r) => r === "correct" || r === "applied",
  ).length;

  useEffect(() => {
    async function load() {
      if (!courseId || !user) return;
      setLoading(true);

      const { data: courseRow } = await supabase
        .from("courses")
        .select("id, title, department_id")
        .eq("id", courseId)
        .single();
      if (!courseRow) {
        setLoading(false);
        return;
      }
      setCourseTitle(courseRow.title);

      const { data: grant } = await supabase
        .from("access_grants")
        .select("department_id")
        .eq("user_id", user.id)
        .eq("department_id", courseRow.department_id)
        .maybeSingle();
      if (!grant) {
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      const [
        { data: questionRows },
        { data: outlineRows },
        { data: progress },
      ] = await Promise.all([
        supabase
          .from("questions")
          .select("id, type, prompt, expected_answer, explanation, sort_order")
          .eq("course_id", courseId)
          .eq("status", "active")
          .order("sort_order"),
        supabase
          .from("course_outline_sections")
          .select("title, start_question_order, end_question_order")
          .eq("course_id", courseId)
          .order("sort_order"),
        supabase
          .from("study_progress")
          .select("current_order, completed")
          .eq("user_id", user.id)
          .eq("course_id", courseId)
          .maybeSingle(),
      ]);

      const questionIds = (questionRows ?? []).map((q) => q.id);
      const { data: optionRows } =
        questionIds.length > 0
          ? await supabase
              .from("question_options")
              .select("id, question_id, label, body, is_correct")
              .in("question_id", questionIds)
              .order("sort_order")
          : { data: [] };

      setQuestions(
        (questionRows ?? []).map((q) => ({
          ...q,
          options: (optionRows ?? []).filter((o) => o.question_id === q.id),
        })),
      );
      setOutline(outlineRows ?? []);

      if (progress?.completed) {
        setShowResults(true);
      } else if (progress) {
        setCurrentIndex(
          Math.min(progress.current_order, (questionRows?.length ?? 1) - 1),
        );
      }
      setLoading(false);
    }
    void load();
  }, [courseId, user]);

  // Per-question timer
  useEffect(() => {
    if (!question || submitted || showResults) return;
    const limit =
      question.type === "application" ? APPLICATION_SECONDS : OBJECTIVE_SECONDS;
    setSecondsLeft(limit);
    questionStartRef.current = Date.now();

    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(interval);
          void handleSubmit(true);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, question?.id, submitted, showResults]);

  const activeSection = useMemo(
    () =>
      outline.find(
        (s) =>
          currentIndex + 1 >= s.start_question_order &&
          currentIndex + 1 <= s.end_question_order,
      ),
    [outline, currentIndex],
  );

  async function handleSubmit(timedOut = false) {
    if (!question || submitted) return;
    const timeTaken = Math.round(
      (Date.now() - questionStartRef.current) / 1000,
    );

    let result: Result;
    if (question.type === "application") {
      result = timedOut && !selectedOptionId ? "skipped" : "applied";
    } else if (timedOut && !selectedOptionId) {
      result = "skipped";
    } else {
      const chosen = question.options.find((o) => o.id === selectedOptionId);
      result = chosen?.is_correct ? "correct" : "incorrect";
    }

    setSubmitted(true);
    setSessionResults((prev) => ({ ...prev, [question.id]: result }));

    const isLast = currentIndex === questions.length - 1;
    const nextOrder = currentIndex + 1;

    await supabase.rpc("record_question_attempt", {
      p_course_id: courseId,
      p_question_id: question.id,
      p_selected_option_id:
        question.type === "objective" ? selectedOptionId : null,
      p_result: result,
      p_time_taken_seconds: timeTaken,
      p_current_order: nextOrder,
      p_completed: isLast,
    });
  }

  function handleNext() {
    const isLast = currentIndex === questions.length - 1;
    const reachedSectionEnd =
      activeSection && currentIndex + 1 === activeSection.end_question_order;

    if (isLast) {
      setShowResults(true);
      return;
    }
    if (reachedSectionEnd) {
      setSectionComplete(activeSection);
      return;
    }
    advance();
  }

  function advance() {
    setCurrentIndex((i) => i + 1);
    setSelectedOptionId(null);
    setSubmitted(false);
    setSectionComplete(null);
  }

  async function handleResync() {
    await supabase.rpc("reset_study_progress", { p_course_id: courseId });
    window.location.reload();
  }

  if (loading) {
    return (
      <Layout title="Studying" onBack={() => navigate(-1)}>
        <p className="text-sm text-text-3">Loading…</p>
      </Layout>
    );
  }

  if (accessDenied) {
    return (
      <Layout
        title="Restricted"
        onBack={() => navigate(`/courses/${courseId}`)}
      >
        <p className="text-sm text-text-3">
          You don't have access to this course.
        </p>
      </Layout>
    );
  }

  if (questions.length === 0) {
    return (
      <Layout
        title={courseTitle}
        onBack={() => navigate(`/courses/${courseId}`)}
      >
        <p className="text-sm text-text-3">
          No study content available for this course yet.
        </p>
      </Layout>
    );
  }

  if (showResults) {
    const pct =
      totalSubmitted > 0
        ? Math.round((totalCorrect / totalSubmitted) * 100)
        : 0;
    return (
      <Layout
        title={courseTitle}
        onBack={() => navigate(`/courses/${courseId}`)}
      >
        <div className="card-luxury p-8 text-center">
          <h2 className="font-heading text-2xl font-bold text-text-1">
            {totalCorrect} / {totalSubmitted || questions.length}
          </h2>
          <p className="mt-1 text-sm text-text-3">{pct}% compliance</p>
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-canvas-soft">
            <div
              className="h-full bg-royal transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-6 flex gap-3">
            <button
              onClick={() => void handleResync()}
              className="btn-outline flex-1"
            >
              Re-sync
            </button>
            <button
              onClick={() => navigate(`/courses/${courseId}`)}
              className="btn-primary flex-1"
            >
              Exit
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  if (sectionComplete) {
    const sectionEntries = Object.entries(sessionResults).slice(
      -(
        sectionComplete.end_question_order -
        sectionComplete.start_question_order +
        1
      ),
    );
    const sectionCorrect = sectionEntries.filter(
      ([, r]) => r === "correct" || r === "applied",
    ).length;
    const sectionPct =
      sectionEntries.length > 0
        ? Math.round((sectionCorrect / sectionEntries.length) * 100)
        : 0;
    const message =
      sectionPct >= 90
        ? "Outstanding mastery."
        : sectionPct >= 70
          ? "Solid progress."
          : "Keep going.";
    const isLastSection =
      outline[outline.length - 1]?.title === sectionComplete.title;

    return (
      <Layout
        title={courseTitle}
        onBack={() => navigate(`/courses/${courseId}`)}
      >
        <div className="card-luxury p-8 text-center">
          <h2 className="font-heading text-lg font-bold text-text-1">
            Section complete
          </h2>
          <p className="mt-1 text-sm text-text-3">{sectionComplete.title}</p>
          <p className="mt-4 font-heading text-3xl font-bold text-royal">
            {sectionPct}%
          </p>
          <p className="mt-1 text-sm text-text-3">{message}</p>
          <div className="mt-6 flex gap-3">
            <button
              onClick={() => navigate(`/courses/${courseId}`)}
              className="btn-outline flex-1"
            >
              Outline
            </button>
            <button
              onClick={() => (isLastSection ? setShowResults(true) : advance())}
              className="btn-primary flex-1"
            >
              {isLastSection ? "Final results" : "Next section"}
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={courseTitle} onBack={() => navigate(`/courses/${courseId}`)}>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-text-3">
          Question {currentIndex + 1} of {questions.length}
        </span>
        <span
          className={`rounded-full px-2.5 py-1 font-semibold ${
            secondsLeft <= 10
              ? "animate-pulse bg-rose-100 text-rose-700"
              : "bg-canvas-soft text-text-2"
          }`}
        >
          {secondsLeft}s
        </span>
      </div>
      <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-canvas-soft">
        <div
          className="h-full bg-royal transition-all"
          style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
        />
      </div>

      <div className="card-luxury p-6">
        <p className="font-medium text-text-1">{question.prompt}</p>

        {question.type === "objective" ? (
          <div className="mt-4 space-y-2">
            {question.options.map((opt) => {
              const isSelected = selectedOptionId === opt.id;
              const showCorrect = submitted && opt.is_correct;
              const showWrong = submitted && isSelected && !opt.is_correct;
              return (
                <button
                  key={opt.id}
                  disabled={submitted}
                  onClick={() => setSelectedOptionId(opt.id)}
                  className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                    showCorrect
                      ? "border-emerald-400 bg-emerald-50 text-emerald-800"
                      : showWrong
                        ? "border-rose-400 bg-rose-50 text-rose-800"
                        : isSelected
                          ? "border-royal bg-royal-soft text-royal"
                          : submitted
                            ? "border-canvas-border opacity-50"
                            : "border-canvas-border hover:border-royal/40"
                  }`}
                >
                  <span className="font-semibold">{opt.label}.</span> {opt.body}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mt-4">
            {submitted && (
              <div className="diamond-gradient rounded-xl p-4 text-sm text-white">
                <p className="font-semibold">Expected response</p>
                <p className="mt-1 text-white/90">
                  {question.expected_answer || "No expected answer recorded."}
                </p>
              </div>
            )}
          </div>
        )}

        {submitted && question.explanation && (
          <div className="mt-4 rounded-xl bg-navy p-4 text-sm text-white">
            <p className="font-semibold">Explanation</p>
            <p className="mt-1 text-white/90">{question.explanation}</p>
          </div>
        )}

        <div className="mt-6 flex gap-3">
          {!submitted ? (
            <button
              onClick={() => void handleSubmit(false)}
              disabled={question.type === "objective" && !selectedOptionId}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              {question.type === "application"
                ? "Check answer"
                : "Commit solution"}
            </button>
          ) : (
            <button onClick={handleNext} className="btn-primary flex-1">
              {currentIndex === questions.length - 1 ? "Finish" : "Next"}
            </button>
          )}
        </div>
      </div>
    </Layout>
  );
}

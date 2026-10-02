import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { AdminLayout } from "@/components/AdminLayout";
import { parseCSV, downloadCSV } from "@/lib/csv";

interface Course {
  id: string;
  title: string;
  default_question_type: "objective" | "application";
}

interface Option {
  id: string;
  label: string;
  body: string;
  is_correct: boolean;
}

interface Question {
  id: string;
  type: "objective" | "application";
  prompt: string;
  expected_answer: string | null;
  explanation: string | null;
  sort_order: number;
  options: Option[];
}

const OPTION_LABELS = ["A", "B", "C", "D", "E"];

export default function AdminQuestions() {
  const { courseId } = useParams<{ courseId: string }>();
  const [course, setCourse] = useState<Course | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [type, setType] = useState<"objective" | "application">("objective");
  const [prompt, setPrompt] = useState("");
  const [explanation, setExplanation] = useState("");
  const [expectedAnswer, setExpectedAnswer] = useState("");
  const [options, setOptions] = useState(["", "", "", ""]);
  const [correctIndex, setCorrectIndex] = useState(0);

  async function load() {
    if (!courseId) return;
    setLoading(true);

    const { data: courseRow } = await supabase
      .from("courses")
      .select("id, title, default_question_type")
      .eq("id", courseId)
      .single();
    setCourse(courseRow);
    if (courseRow) setType(courseRow.default_question_type);

    const { data: questionRows } = await supabase
      .from("questions")
      .select("id, type, prompt, expected_answer, explanation, sort_order")
      .eq("course_id", courseId)
      .eq("status", "active")
      .order("sort_order");

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
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (type === "objective" && options.filter((o) => o.trim()).length < 2) {
      setError("Add at least two options.");
      return;
    }
    if (type === "application" && !expectedAnswer.trim()) {
      setError("Add the expected answer.");
      return;
    }

    setSaving(true);
    const { data: question, error: qError } = await supabase
      .from("questions")
      .insert({
        course_id: courseId,
        type,
        prompt,
        explanation: explanation || null,
        expected_answer: type === "application" ? expectedAnswer : null,
        sort_order: questions.length,
      })
      .select("id")
      .single();

    if (qError || !question) {
      setSaving(false);
      setError(qError?.message ?? "Failed to create question.");
      return;
    }

    if (type === "objective") {
      const rows = options
        .map((body, i) => ({ body, i }))
        .filter((o) => o.body.trim())
        .map((o) => ({
          question_id: question.id,
          label: OPTION_LABELS[o.i],
          body: o.body,
          is_correct: o.i === correctIndex,
          sort_order: o.i,
        }));
      await supabase.from("question_options").insert(rows);
    }

    setPrompt("");
    setExplanation("");
    setExpectedAnswer("");
    setOptions(["", "", "", ""]);
    setCorrectIndex(0);
    setSaving(false);
    await load();
  }

  async function handleRemove(id: string) {
    await supabase
      .from("questions")
      .update({ status: "trashed", deleted_at: new Date().toISOString() })
      .eq("id", id);
    await load();
  }

  function downloadTemplate() {
    const isApp = course?.default_question_type === "application";
    const headers = isApp
      ? ["Question", "Expected Answer"]
      : [
          "Question",
          "Option A",
          "Option B",
          "Option C",
          "Option D",
          "Option E",
          "Correct Answer (A-E or 0-4)",
          "Explanation",
        ];
    const sampleRow = isApp
      ? [
          "Describe the key concepts of the system architecture.",
          "Key concepts: microservices decoupling, event-driven processing.",
        ]
      : [
          "Sample question?",
          "Option 1",
          "Option 2",
          "Option 3",
          "Option 4",
          "Option 5",
          "A",
          "Because it is A",
        ];
    downloadCSV(
      isApp
        ? "application_question_template.csv"
        : "question_import_template.csv",
      [headers, sampleRow],
    );
  }

  function handleExport() {
    if (!course || questions.length === 0) return;
    const isApp = course.default_question_type === "application";
    const headers = isApp
      ? ["Question", "Expected Answer"]
      : [
          "Question",
          "Option A",
          "Option B",
          "Option C",
          "Option D",
          "Option E",
          "Correct Answer (A-E or 0-4)",
          "Explanation",
        ];
    const rows = questions.map((q) => {
      if (isApp) return [q.prompt, q.expected_answer ?? ""];
      const byLabel = (label: string) =>
        q.options.find((o) => o.label === label)?.body ?? "";
      const correct = q.options.find((o) => o.is_correct)?.label ?? "A";
      return [
        q.prompt,
        byLabel("A"),
        byLabel("B"),
        byLabel("C"),
        byLabel("D"),
        byLabel("E"),
        correct,
        q.explanation ?? "",
      ];
    });
    downloadCSV(`archive_${course.title.replace(/\s+/g, "_")}.csv`, [
      headers,
      ...rows,
    ]);
  }

  // Column mapping matches the old app's export exactly (see 05-BACKEND.md's note on this
  // being the migration path from the old question bank) — objective: question, options A-E,
  // correct answer (letter A-E or index 0-4), explanation; application: question, expected
  // answer (or column 7, for a file exported from the 8-column objective-style template).
  async function handleImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !courseId || !course) return;
    e.target.value = "";

    const text = await file.text();
    const rows = parseCSV(text).slice(1); // drop header
    const isApp = course.default_question_type === "application";

    setImporting(true);
    setError(null);
    let imported = 0;
    let nextOrder = questions.length;

    for (const row of rows) {
      if (!row || row.length === 0) continue;
      if (!isApp && row.length < 6) continue;
      const questionText = (row[0] ?? "").trim();
      if (isApp && !questionText && !(row[1] ?? "").trim()) continue;
      if (!questionText) continue;

      const { data: inserted, error: qError } = await supabase
        .from("questions")
        .insert({
          course_id: courseId,
          type: isApp ? "application" : "objective",
          prompt: questionText,
          expected_answer: isApp ? (row[1] || row[7] || "").trim() : null,
          explanation: isApp ? null : (row[7] ?? "").trim() || null,
          sort_order: nextOrder++,
        })
        .select("id")
        .single();

      if (qError || !inserted) continue;

      if (!isApp) {
        const rawCorrect = (row[6] ?? "").trim().toUpperCase();
        const correctIndex = OPTION_LABELS.includes(rawCorrect)
          ? OPTION_LABELS.indexOf(rawCorrect)
          : Number.isInteger(Number(rawCorrect)) &&
              Number(rawCorrect) >= 0 &&
              Number(rawCorrect) <= 4
            ? Number(rawCorrect)
            : 0;

        const optionRows = OPTION_LABELS.map((label, i) => ({
          question_id: inserted.id,
          label,
          body: (row[i + 1] ?? "").trim() || `Option ${label}`,
          is_correct: i === correctIndex,
          sort_order: i,
        }));
        await supabase.from("question_options").insert(optionRows);
      }
      imported++;
    }

    setImporting(false);
    await load();
    alert(`${imported} question(s) imported.`);
  }

  if (!course && !loading) {
    return (
      <AdminLayout>
        <p className="text-sm text-text-3">Course not found.</p>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <h1 className="font-heading text-2xl font-bold text-text-1">
        Questions — {course?.title}
      </h1>
      <p className="mt-1 text-sm text-text-3">
        {questions.length} active question(s)
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={downloadTemplate} className="btn-outline text-sm">
          Download template
        </button>
        <button
          onClick={handleExport}
          disabled={questions.length === 0}
          className="btn-outline text-sm disabled:opacity-50"
        >
          Export CSV
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          className="btn-secondary text-sm"
        >
          {importing ? "Importing…" : "Import CSV"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={(e) => void handleImport(e)}
          className="hidden"
        />
      </div>

      <form onSubmit={handleCreate} className="card-luxury mt-6 space-y-4 p-6">
        <h2 className="font-heading text-base font-bold text-text-1">
          Add question
        </h2>

        {error && (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        <div>
          <label className="block text-sm font-medium text-text-2">Type</label>
          <select
            value={type}
            onChange={(e) =>
              setType(e.target.value as "objective" | "application")
            }
            className={`${inputClass} max-w-xs`}
          >
            <option value="objective">Objective (multiple choice)</option>
            <option value="application">Application</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-2">
            Question
          </label>
          <textarea
            required
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className={inputClass}
            rows={3}
          />
        </div>

        {type === "objective" ? (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-text-2">
              Options (select the correct one)
            </label>
            {options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="correct"
                  checked={correctIndex === i}
                  onChange={() => setCorrectIndex(i)}
                  className="h-4 w-4 accent-[#1B3FA0]"
                />
                <span className="w-5 text-sm font-semibold text-text-3">
                  {OPTION_LABELS[i]}
                </span>
                <input
                  value={opt}
                  onChange={(e) => {
                    const next = [...options];
                    next[i] = e.target.value;
                    setOptions(next);
                  }}
                  className={inputClass}
                />
              </div>
            ))}
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-text-2">
              Expected answer
            </label>
            <textarea
              value={expectedAnswer}
              onChange={(e) => setExpectedAnswer(e.target.value)}
              className={inputClass}
              rows={2}
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-text-2">
            Explanation (optional)
          </label>
          <textarea
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            className={inputClass}
            rows={2}
          />
        </div>

        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? "Adding…" : "Add question"}
        </button>
      </form>

      <div className="mt-8 space-y-3">
        {loading ? (
          <p className="text-sm text-text-3">Loading…</p>
        ) : (
          questions.map((q, i) => (
            <div key={q.id} className="card-luxury p-4">
              <div className="flex items-start justify-between gap-4">
                <p className="text-sm font-medium text-text-1">
                  {i + 1}. {q.prompt}
                </p>
                <button
                  onClick={() => void handleRemove(q.id)}
                  className="shrink-0 text-xs font-semibold text-rose-600 hover:underline"
                >
                  Remove
                </button>
              </div>
              {q.type === "objective" ? (
                <ul className="mt-2 space-y-1 text-sm text-text-3">
                  {q.options.map((o) => (
                    <li
                      key={o.id}
                      className={o.is_correct ? "font-semibold text-royal" : ""}
                    >
                      {o.label}. {o.body}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-text-3">
                  Expected: {q.expected_answer}
                </p>
              )}
            </div>
          ))
        )}
      </div>
    </AdminLayout>
  );
}

const inputClass =
  "mt-1 w-full rounded-xl border border-canvas-border bg-white px-3 py-2.5 text-sm text-text-1 transition-colors focus:border-royal focus:outline-none focus:ring-2 focus:ring-royal/15";

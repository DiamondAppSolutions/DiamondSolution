import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { AdminLayout } from "@/components/AdminLayout";

interface Department {
  id: string;
  name: string;
}
interface Level {
  id: string;
  department_id: string;
  label: string;
}
interface Course {
  id: string;
  title: string;
  slug: string;
  status: string;
  department_id: string;
  level_id: string;
  default_question_type: "objective" | "application";
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function AdminCourses() {
  const [searchParams, setSearchParams] = useSearchParams();
  const departmentId = searchParams.get("department") ?? "";

  const [departments, setDepartments] = useState<Department[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [levelId, setLevelId] = useState("");
  const [questionType, setQuestionType] = useState<"objective" | "application">(
    "objective",
  );
  const [description, setDescription] = useState("");

  async function load() {
    setLoading(true);
    const { data: depts } = await supabase
      .from("departments")
      .select("id, name")
      .order("name");
    setDepartments(depts ?? []);

    if (departmentId) {
      const [{ data: levelRows }, { data: courseRows }] = await Promise.all([
        supabase
          .from("department_levels")
          .select("id, department_id, label")
          .eq("department_id", departmentId)
          .order("sort_order"),
        supabase
          .from("courses")
          .select(
            "id, title, slug, status, department_id, level_id, default_question_type",
          )
          .eq("department_id", departmentId)
          .is("deleted_at", null)
          .order("title"),
      ]);
      setLevels(levelRows ?? []);
      setCourses(courseRows ?? []);
    } else {
      setLevels([]);
      setCourses([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
    setLevelId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!departmentId || !levelId) {
      setError("Pick a department and level first.");
      return;
    }
    setSaving(true);

    const { error: insertError } = await supabase.from("courses").insert({
      department_id: departmentId,
      level_id: levelId,
      title,
      slug: slugify(title),
      description: description || null,
      default_question_type: questionType,
      status: "published",
    });

    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setTitle("");
    setDescription("");
    await load();
  }

  function levelLabel(id: string) {
    return levels.find((l) => l.id === id)?.label ?? "—";
  }

  return (
    <AdminLayout>
      <h1 className="font-heading text-2xl font-bold text-text-1">Courses</h1>

      <div className="mt-4">
        <label className="block text-sm font-medium text-text-2">
          Department
        </label>
        <select
          value={departmentId}
          onChange={(e) =>
            setSearchParams(
              e.target.value ? { department: e.target.value } : {},
            )
          }
          className={`${inputClass} max-w-sm`}
        >
          <option value="">Select a department</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      {departmentId && (
        <>
          <form
            onSubmit={handleCreate}
            className="card-luxury mt-6 space-y-4 p-6"
          >
            <h2 className="font-heading text-base font-bold text-text-1">
              Add course
            </h2>

            {error && (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-text-2">
                  Title
                </label>
                <input
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-2">
                  Level
                </label>
                <select
                  required
                  value={levelId}
                  onChange={(e) => setLevelId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Select a level</option>
                  {levels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-2">
                Question type
              </label>
              <select
                value={questionType}
                onChange={(e) =>
                  setQuestionType(e.target.value as "objective" | "application")
                }
                className={`${inputClass} max-w-xs`}
              >
                <option value="objective">Objective (multiple choice)</option>
                <option value="application">Application</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-2">
                Description (optional)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={inputClass}
                rows={3}
              />
            </div>

            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Creating…" : "Create course"}
            </button>
          </form>

          <div className="mt-8">
            {loading ? (
              <p className="text-sm text-text-3">Loading…</p>
            ) : courses.length === 0 ? (
              <p className="text-sm text-text-3">
                No courses yet — add one above.
              </p>
            ) : (
              <div className="space-y-3">
                {courses.map((c) => (
                  <div
                    key={c.id}
                    className="card-luxury flex items-center justify-between p-4"
                  >
                    <div>
                      <p className="font-heading font-bold text-text-1">
                        {c.title}
                      </p>
                      <p className="text-sm text-text-3">
                        {levelLabel(c.level_id)} · {c.default_question_type} ·{" "}
                        {c.status}
                      </p>
                    </div>
                    <Link
                      to={`/admin/courses/${c.id}/questions`}
                      className="text-sm font-semibold text-royal hover:underline"
                    >
                      Manage questions →
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </AdminLayout>
  );
}

const inputClass =
  "mt-1 w-full rounded-xl border border-canvas-border bg-white px-3 py-2.5 text-sm text-text-1 transition-colors focus:border-royal focus:outline-none focus:ring-2 focus:ring-royal/15";

import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { AdminLayout } from "@/components/AdminLayout";

interface Department {
  id: string;
  name: string;
  slug: string;
  status: string;
}

interface PriceRow {
  department_id: string;
  currency: string;
  amount: number;
}

interface LevelRow {
  id: string;
  department_id: string;
  label: string;
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function AdminDepartments() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [levels, setLevels] = useState<LevelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [priceNgn, setPriceNgn] = useState("10000");
  const [levelInput, setLevelInput] = useState("100L, 200L, 300L, 400L");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const [{ data: depts }, { data: priceRows }, { data: levelRows }] =
      await Promise.all([
        supabase
          .from("departments")
          .select("id, name, slug, status")
          .order("name"),
        supabase
          .from("department_pricing")
          .select("department_id, currency, amount"),
        supabase
          .from("department_levels")
          .select("id, department_id, label")
          .order("sort_order"),
      ]);
    setDepartments(depts ?? []);
    setPrices(priceRows ?? []);
    setLevels(levelRows ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const slug = slugify(name);
    const { data: dept, error: deptError } = await supabase
      .from("departments")
      .insert({ name, slug })
      .select("id")
      .single();

    if (deptError || !dept) {
      setSaving(false);
      setError(deptError?.message ?? "Failed to create department.");
      return;
    }

    const amount = Number(priceNgn);
    if (amount > 0) {
      await supabase
        .from("department_pricing")
        .insert({ department_id: dept.id, currency: "NGN", amount });
    }

    const levelLabels = levelInput
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean);
    if (levelLabels.length > 0) {
      await supabase.from("department_levels").insert(
        levelLabels.map((label, i) => ({
          department_id: dept.id,
          label,
          sort_order: i,
        })),
      );
    }

    setName("");
    setSaving(false);
    await load();
  }

  function priceFor(deptId: string) {
    const row = prices.find(
      (p) => p.department_id === deptId && p.currency === "NGN",
    );
    return row ? `₦${row.amount.toLocaleString()}` : "No price set";
  }

  function levelsFor(deptId: string) {
    return levels.filter((l) => l.department_id === deptId).map((l) => l.label);
  }

  return (
    <AdminLayout>
      <h1 className="font-heading text-2xl font-bold text-text-1">
        Departments
      </h1>
      <p className="mt-1 text-sm text-text-3">
        Create a department, set its price, and define its levels. Courses are
        added per department on the Courses tab.
      </p>

      <form onSubmit={handleCreate} className="card-luxury mt-6 space-y-4 p-6">
        <h2 className="font-heading text-base font-bold text-text-1">
          Add department
        </h2>

        {error && (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-text-2">
              Name
            </label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="Nursing"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-2">
              Price (₦)
            </label>
            <input
              type="number"
              min={0}
              value={priceNgn}
              onChange={(e) => setPriceNgn(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-2">
            Levels (comma-separated)
          </label>
          <input
            value={levelInput}
            onChange={(e) => setLevelInput(e.target.value)}
            className={inputClass}
          />
        </div>

        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? "Creating…" : "Create department"}
        </button>
      </form>

      <div className="mt-8">
        {loading ? (
          <p className="text-sm text-text-3">Loading…</p>
        ) : departments.length === 0 ? (
          <p className="text-sm text-text-3">
            No departments yet — add one above.
          </p>
        ) : (
          <div className="space-y-3">
            {departments.map((d) => (
              <div
                key={d.id}
                className="card-luxury flex items-center justify-between p-4"
              >
                <div>
                  <p className="font-heading font-bold text-text-1">{d.name}</p>
                  <p className="text-sm text-text-3">
                    {priceFor(d.id)} ·{" "}
                    {levelsFor(d.id).join(", ") || "no levels"}
                  </p>
                </div>
                <Link
                  to={`/admin/courses?department=${d.id}`}
                  className="text-sm font-semibold text-royal hover:underline"
                >
                  Manage courses →
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

const inputClass =
  "mt-1 w-full rounded-xl border border-canvas-border bg-white px-3 py-2.5 text-sm text-text-1 transition-colors focus:border-royal focus:outline-none focus:ring-2 focus:ring-royal/15";

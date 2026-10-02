import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePaystackPayment } from "react-paystack";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { Layout } from "@/components/Layout";

interface Department {
  id: string;
  name: string;
  slug: string;
}
interface PriceRow {
  department_id: string;
  amount: number;
  currency: string;
}
interface Course {
  id: string;
  title: string;
  level_id: string;
}
interface Level {
  id: string;
  label: string;
}

export default function CourseList() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const departmentId = searchParams.get("department") ?? "";

  const [departments, setDepartments] = useState<Department[]>([]);
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [grantedDepartmentIds, setGrantedDepartmentIds] = useState<Set<string>>(
    new Set(),
  );
  const [courses, setCourses] = useState<Course[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    async function loadOverview() {
      const [{ data: depts }, { data: priceRows }, { data: grants }] =
        await Promise.all([
          supabase
            .from("departments")
            .select("id, name, slug")
            .eq("status", "active")
            .order("name"),
          supabase
            .from("department_pricing")
            .select("department_id, amount, currency"),
          user
            ? supabase
                .from("access_grants")
                .select("department_id")
                .eq("user_id", user.id)
            : Promise.resolve({ data: [] as { department_id: string }[] }),
        ]);
      setDepartments(depts ?? []);
      setPrices(priceRows ?? []);
      setGrantedDepartmentIds(
        new Set((grants ?? []).map((g) => g.department_id)),
      );
    }
    void loadOverview();
  }, [user]);

  useEffect(() => {
    async function loadCourses() {
      if (!departmentId) {
        setCourses([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const [{ data: courseRows }, { data: levelRows }] = await Promise.all([
        supabase
          .from("courses")
          .select("id, title, level_id")
          .eq("department_id", departmentId)
          .eq("status", "published")
          .is("deleted_at", null)
          .order("title"),
        supabase
          .from("department_levels")
          .select("id, label")
          .eq("department_id", departmentId),
      ]);
      setCourses(courseRows ?? []);
      setLevels(levelRows ?? []);
      setLoading(false);
    }
    void loadCourses();
  }, [departmentId]);

  const activeDept = departments.find((d) => d.id === departmentId);
  const hasAccess = departmentId
    ? grantedDepartmentIds.has(departmentId)
    : false;
  const price = prices.find(
    (p) => p.department_id === departmentId && p.currency === "NGN",
  );

  const paystackConfig = {
    reference: `dept_${departmentId}_${user?.id}_${Date.now()}`,
    email: user?.email ?? "",
    amount: Math.round((price?.amount ?? 0) * 100),
    publicKey: import.meta.env.VITE_PAYSTACK_PUBLIC_KEY ?? "",
    currency: "NGN",
    metadata: {
      user_id: user?.id,
      department_id: departmentId,
      custom_fields: [],
    },
  };
  const initializePayment = usePaystackPayment(paystackConfig);

  async function handlePay() {
    if (!paystackConfig.publicKey) {
      alert(
        "Payments aren't configured yet (missing VITE_PAYSTACK_PUBLIC_KEY).",
      );
      return;
    }
    initializePayment({
      onSuccess: async (transaction: { reference: string }) => {
        setPaying(true);
        const { data, error } = await supabase.functions.invoke(
          "verify-payment",
          {
            body: {
              reference: transaction.reference,
              department_id: departmentId,
            },
          },
        );
        setPaying(false);
        if (error || !data?.success) {
          alert(
            `Payment verification failed: ${error?.message ?? data?.error ?? "unknown error"}`,
          );
          return;
        }
        setGrantedDepartmentIds((prev) => new Set(prev).add(departmentId));
      },
      onClose: () => {},
    });
  }

  function levelLabel(id: string) {
    return levels.find((l) => l.id === id)?.label ?? "";
  }

  if (!departmentId) {
    return (
      <Layout title="Departments">
        <div className="space-y-3">
          {departments.map((d) => {
            const granted = grantedDepartmentIds.has(d.id);
            return (
              <button
                key={d.id}
                onClick={() => setSearchParams({ department: d.id })}
                className="card-luxury flex w-full items-center justify-between p-4 text-left"
              >
                <span className="font-heading font-bold text-text-1">
                  {d.name}
                </span>
                {granted && <span className="badge-royal">Authorized</span>}
              </button>
            );
          })}
          {departments.length === 0 && (
            <p className="text-sm text-text-3">No departments available yet.</p>
          )}
        </div>
      </Layout>
    );
  }

  return (
    <Layout
      title={activeDept?.name ?? "Department"}
      onBack={() => setSearchParams({})}
    >
      {!hasAccess ? (
        <div className="card-luxury p-8 text-center">
          <h2 className="font-heading text-lg font-bold text-text-1">
            Restricted
          </h2>
          <p className="mt-2 text-sm text-text-3">
            Pay once for lifetime access to every course in {activeDept?.name}.
          </p>
          <button
            onClick={() => void handlePay()}
            disabled={paying}
            className="btn-primary mt-6 w-full"
          >
            {paying
              ? "Confirming…"
              : `Authorize payment — ₦${price?.amount.toLocaleString() ?? "—"}`}
          </button>
          {profile?.currency === "USD" && (
            <p className="mt-2 text-xs text-text-3">
              Charged in NGN via Paystack.
            </p>
          )}
        </div>
      ) : loading ? (
        <p className="text-sm text-text-3">Loading…</p>
      ) : courses.length === 0 ? (
        <p className="text-sm text-text-3">
          No courses in this department yet.
        </p>
      ) : (
        <div className="space-y-3">
          {courses.map((c) => (
            <button
              key={c.id}
              onClick={() => navigate(`/courses/${c.id}`)}
              className="card-luxury flex w-full items-center justify-between p-4 text-left"
            >
              <span className="font-heading font-bold text-text-1">
                {c.title}
              </span>
              <span className="badge-royal">{levelLabel(c.level_id)}</span>
            </button>
          ))}
        </div>
      )}
    </Layout>
  );
}

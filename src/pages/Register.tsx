import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { validatePassword } from "@/lib/passwordPolicy";
import { DiamondLogo } from "@/components/DiamondLogo";
import { AuthTabs } from "@/components/AuthTabs";

interface Department {
  id: string;
  name: string;
}

export default function Register() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [form, setForm] = useState({
    displayName: "",
    username: "",
    university: "",
    departmentId: "",
    whatsapp: "",
    email: "",
    password: "",
    confirmPassword: "",
    referralCode:
      searchParams.get("ref") ?? sessionStorage.getItem("referralCode") ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase
      .from("departments")
      .select("id, name")
      .eq("status", "active")
      .order("name")
      .then(({ data }) => setDepartments(data ?? []));
  }, []);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    const passwordError = validatePassword(form.password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setLoading(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        // Consumed by the handle_new_user trigger (see the init migration) so the full
        // profile exists the moment the auth.users row is created — works whether or not
        // email confirmation leaves this signUp() call without an active session.
        data: {
          display_name: form.displayName,
          username: form.username.toLowerCase().replace(/\s+/g, ""),
          university: form.university,
          department_id: form.departmentId || null,
          whatsapp: form.whatsapp ? `+234${form.whatsapp}` : "",
          phone: form.whatsapp ? `+234${form.whatsapp}` : "",
          language: "en",
          referral_code: form.referralCode || null,
        },
      },
    });

    setLoading(false);
    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    if (data.session) {
      navigate("/dashboard");
    } else {
      setInfo("Check your email to confirm your account, then sign in.");
    }
  }

  return (
    <div className="diamond-mesh flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <DiamondLogo size={48} showTagline />
        </div>

        <div className="card-luxury p-8">
          <AuthTabs active="register" />

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </p>
            )}
            {info && (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {info}
              </p>
            )}

            <Field label="Full name">
              <input
                required
                value={form.displayName}
                onChange={(e) => update("displayName", e.target.value)}
                className={inputClass}
              />
            </Field>

            <Field label="Username">
              <input
                required
                value={form.username}
                onChange={(e) => update("username", e.target.value)}
                className={inputClass}
              />
            </Field>

            <Field label="Institution / University (full name)">
              <input
                placeholder="e.g. University of Ibadan"
                value={form.university}
                onChange={(e) => update("university", e.target.value)}
                className={inputClass}
              />
            </Field>

            <Field label="Department">
              <select
                value={form.departmentId}
                onChange={(e) => update("departmentId", e.target.value)}
                className={inputClass}
              >
                <option value="">Select a department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="WhatsApp number">
              <div className="mt-1 flex gap-2">
                <span className="flex items-center gap-1 rounded-xl border border-canvas-border bg-canvas-soft px-3 text-sm text-text-2">
                  🇳🇬 +234
                </span>
                <input
                  value={form.whatsapp}
                  onChange={(e) =>
                    update("whatsapp", e.target.value.replace(/\D/g, ""))
                  }
                  placeholder="8011223344"
                  className={`${inputClass} mt-0 flex-1`}
                />
              </div>
            </Field>

            <Field label="Email">
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
                className={inputClass}
              />
            </Field>

            <Field label="Password">
              <input
                type="password"
                required
                value={form.password}
                onChange={(e) => update("password", e.target.value)}
                className={inputClass}
              />
            </Field>

            <Field label="Confirm password">
              <input
                type="password"
                required
                value={form.confirmPassword}
                onChange={(e) => update("confirmPassword", e.target.value)}
                className={inputClass}
              />
            </Field>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full"
            >
              {loading ? "Creating account…" : "Create account"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-text-3">
          Diamond Solution is an independent study platform and is not
          affiliated with, endorsed by, or sponsored by any professional
          licensing or certification board.
        </p>
      </div>
    </div>
  );
}

const inputClass =
  "mt-1 w-full rounded-xl border border-canvas-border bg-white px-3 py-2.5 text-sm text-text-1 transition-colors focus:border-royal focus:outline-none focus:ring-2 focus:ring-royal/15";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-text-2">{label}</label>
      {children}
    </div>
  );
}

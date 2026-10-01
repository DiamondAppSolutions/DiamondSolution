import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { validatePassword } from "@/lib/passwordPolicy";

interface Department {
  id: string;
  name: string;
}

export default function Register() {
  const navigate = useNavigate();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [form, setForm] = useState({
    displayName: "",
    username: "",
    institutionName: "",
    university: "",
    departmentId: "",
    whatsapp: "",
    email: "",
    password: "",
    confirmPassword: "",
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
          institution_name: form.institutionName,
          university: form.university,
          department_id: form.departmentId || null,
          whatsapp: form.whatsapp,
          phone: form.whatsapp,
          language: "en",
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
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-4 rounded-xl bg-white p-8 shadow-sm"
      >
        <h1 className="text-xl font-semibold text-slate-900">Create account</h1>

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
        {info && (
          <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{info}</p>
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

        <Field label="Institution">
          <input
            value={form.institutionName}
            onChange={(e) => update("institutionName", e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="University">
          <input
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
          <input
            value={form.whatsapp}
            onChange={(e) => update("whatsapp", e.target.value)}
            placeholder="+2348012345678"
            className={inputClass}
          />
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
          className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {loading ? "Creating account…" : "Create account"}
        </button>

        <p className="text-center text-sm text-slate-500">
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-blue-600 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}

const inputClass =
  "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      {children}
    </div>
  );
}

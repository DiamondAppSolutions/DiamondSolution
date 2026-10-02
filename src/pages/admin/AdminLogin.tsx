import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

export default function AdminLogin() {
  const navigate = useNavigate();
  const { user, isAdmin, isModerator, loading, signOut } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // True once a sign-in attempt has happened this page load — gates the role-check effect
  // below so it never fires on an already-signed-in regular visit to this URL, only right
  // after this form's own submit.
  const [awaitingRoleCheck, setAwaitingRoleCheck] = useState(false);

  useEffect(() => {
    if (!awaitingRoleCheck || loading) return;

    if (!user) {
      setAwaitingRoleCheck(false);
      return;
    }

    if (isAdmin || isModerator) {
      navigate("/admin/departments");
      return;
    }

    // A real account, correct password, just not staff — sign it back out rather than
    // leaving a non-admin quietly authenticated on the admin entry point.
    setAwaitingRoleCheck(false);
    void signOut().then(() => {
      setError("This account doesn't have admin or moderator access.");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingRoleCheck, loading, user, isAdmin, isModerator]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setSubmitting(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    setAwaitingRoleCheck(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-white">
          <div className="rounded-full bg-white/10 p-3">
            <ShieldCheck size={28} className="text-gold" />
          </div>
          <p className="font-heading text-lg font-bold">Admin Access</p>
          <p className="text-xs text-slate-400">Staff sign-in only</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur"
        >
          {error && (
            <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {error}
            </p>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-300">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </div>

          <button
            type="submit"
            disabled={submitting || awaitingRoleCheck}
            className="btn-gold w-full"
          >
            {submitting || awaitingRoleCheck ? "Checking…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-400">
          Not staff?{" "}
          <Link to="/login" className="font-semibold text-gold hover:underline">
            Student sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

const inputClass =
  "mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-slate-500 transition-colors focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20";

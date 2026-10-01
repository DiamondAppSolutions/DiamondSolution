import { useAuth } from "@/context/AuthContext";

export default function Dashboard() {
  const { user, profile, roles, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-2xl space-y-4 rounded-xl bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">
          Welcome, {profile?.display_name ?? user?.email}
        </h1>
        <p className="text-sm text-slate-500">Signed in as {user?.email}</p>
        <p className="text-sm text-slate-500">Roles: {roles.length ? roles.join(", ") : "student (default)"}</p>
        <p className="text-sm text-slate-400">
          Placeholder — the real dashboard (stats, study resume, leaderboard widget) is built
          in Phase 2 per 04-ROADMAP.md.
        </p>
        <button
          onClick={() => void signOut()}
          className="rounded-md bg-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

import { useAuth } from "@/context/AuthContext";
import { DiamondLogo } from "@/components/DiamondLogo";

export default function Dashboard() {
  const { user, profile, roles, signOut } = useAuth();

  return (
    <div className="diamond-mesh min-h-screen p-6 sm:p-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <DiamondLogo layout="horizontal" size={40} />
          <button onClick={() => void signOut()} className="btn-outline">
            Sign out
          </button>
        </div>

        <div className="card-luxury p-6 sm:p-8">
          <h1 className="font-heading text-xl font-bold text-text-1">
            Welcome, {profile?.display_name ?? user?.email}
          </h1>
          <p className="mt-1 text-sm text-text-3">Signed in as {user?.email}</p>

          <div className="mt-4">
            <span className="badge-royal">
              {roles.length ? roles.join(", ") : "student"}
            </span>
          </div>

          <p className="mt-6 text-sm text-text-3">
            Placeholder — the real dashboard (stats, study resume, leaderboard
            widget) is built in Phase 2 per{" "}
            <code className="text-xs">docs/design/04-ROADMAP.md</code>.
          </p>
        </div>
      </div>
    </div>
  );
}

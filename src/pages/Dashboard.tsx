import { useAuth } from "@/context/AuthContext";
import { Layout } from "@/components/Layout";

export default function Dashboard() {
  const { user, profile, roles } = useAuth();

  return (
    <Layout title="Dashboard">
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
    </Layout>
  );
}

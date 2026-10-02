import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

export function ProtectedRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        Loading…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

export function AdminRoute() {
  const { user, isAdmin, isModerator, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        Loading…
      </div>
    );
  }

  // Not signed in at all → the admin sign-in page, not the student one.
  if (!user) {
    return <Navigate to="/admin/login" replace />;
  }

  // A real, signed-in account, just not staff → their own dashboard, not back to a login
  // page they'd only fail again.
  if (!isAdmin && !isModerator) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}

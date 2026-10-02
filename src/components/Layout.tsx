import { Link, useLocation } from "react-router-dom";
import { ChevronLeft, Home, BookOpen, Shield, LogOut } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

interface LayoutProps {
  title: string;
  onBack?: () => void;
  children: React.ReactNode;
}

const NAV = [
  { to: "/dashboard", label: "Home", icon: Home },
  { to: "/courses", label: "Courses", icon: BookOpen },
];

export function Layout({ title, onBack, children }: LayoutProps) {
  const { isAdmin, signOut } = useAuth();
  const location = useLocation();

  return (
    <div className="diamond-mesh min-h-screen pb-24">
      <header className="sticky top-0 z-10 border-b border-canvas-border bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          {onBack && (
            <button
              onClick={onBack}
              className="rounded-full p-1.5 hover:bg-canvas-soft"
            >
              <ChevronLeft size={20} className="text-text-2" />
            </button>
          )}
          <h1 className="font-heading text-lg font-bold text-text-1">
            {title}
          </h1>
          <button
            onClick={() => void signOut()}
            className="ml-auto rounded-full p-1.5 text-text-3 hover:bg-canvas-soft"
            title="Sign out"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">{children}</main>

      <nav className="fixed bottom-4 left-1/2 flex -translate-x-1/2 gap-1 rounded-2xl border border-canvas-border bg-navy px-2 py-2 shadow-lg">
        {NAV.map(({ to, label, icon: Icon }) => {
          const active = location.pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className={`flex flex-col items-center gap-0.5 rounded-xl px-4 py-1.5 text-xs font-semibold transition-colors ${
                active
                  ? "bg-white/15 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
        {isAdmin && (
          <Link
            to="/admin/departments"
            className={`flex flex-col items-center gap-0.5 rounded-xl px-4 py-1.5 text-xs font-semibold transition-colors ${
              location.pathname.startsWith("/admin")
                ? "bg-white/15 text-white"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Shield size={18} />
            Admin
          </Link>
        )}
      </nav>
    </div>
  );
}

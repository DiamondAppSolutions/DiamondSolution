import { Link, useLocation } from "react-router-dom";
import { DiamondLogo } from "@/components/DiamondLogo";

const TABS = [
  { to: "/admin/departments", label: "Departments" },
  { to: "/admin/courses", label: "Courses" },
  { to: "/admin/payments", label: "Transactions" },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-canvas-border bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <DiamondLogo layout="horizontal" size={32} />
            <nav className="flex gap-1">
              {TABS.map((tab) => (
                <Link
                  key={tab.to}
                  to={tab.to}
                  className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors ${
                    location.pathname.startsWith(tab.to)
                      ? "bg-royal-soft text-royal"
                      : "text-text-3 hover:bg-canvas-soft"
                  }`}
                >
                  {tab.label}
                </Link>
              ))}
            </nav>
          </div>
          <Link
            to="/dashboard"
            className="text-sm font-semibold text-royal hover:underline"
          >
            Back to app
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}

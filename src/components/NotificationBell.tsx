import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
}

export function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  async function load() {
    if (!user) return;
    const { data } = await supabase
      .from("notifications")
      .select("id, type, title, body, read, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    setNotifications(data ?? []);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next) await load();
  }

  async function markOne(id: string) {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    await supabase.rpc("mark_notification_read", { p_notification_id: id });
  }

  async function markAll() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await supabase.rpc("mark_all_notifications_read");
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => void toggleOpen()}
        className="relative rounded-full p-1.5 text-text-3 hover:bg-canvas-soft"
        title="Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-bold text-navy">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 max-w-[85vw] rounded-2xl border border-canvas-border bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-canvas-border px-4 py-3">
            <p className="font-heading text-sm font-bold text-text-1">
              Notifications
            </p>
            {unreadCount > 0 && (
              <button
                onClick={() => void markAll()}
                className="text-xs font-semibold text-royal hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-text-3">
                No notifications yet.
              </p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => !n.read && void markOne(n.id)}
                  className={`block w-full border-b border-canvas-border px-4 py-3 text-left last:border-0 ${
                    n.read ? "bg-white" : "bg-royal-soft/40"
                  } hover:bg-canvas-soft`}
                >
                  <p className="text-sm font-semibold text-text-1">{n.title}</p>
                  <p className="mt-0.5 text-xs text-text-3">{n.body}</p>
                  <p className="mt-1 text-[10px] text-text-3">
                    {formatDistanceToNow(new Date(n.created_at), {
                      addSuffix: true,
                    })}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

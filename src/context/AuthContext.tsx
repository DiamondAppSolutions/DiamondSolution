import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export interface Profile {
  user_id: string;
  display_name: string | null;
  username: string | null;
  institution_name: string | null;
  university: string | null;
  department_id: string | null;
  phone: string | null;
  whatsapp: string | null;
  language: "en" | "fr";
  currency: "NGN" | "USD";
  status: "active" | "suspended";
  suspension_reason: string | null;
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: string[];
  isAdmin: boolean;
  isModerator: boolean;
  isSuspended: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadProfileAndRoles(userId: string) {
    const [{ data: profileRow }, { data: roleRows }] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    setProfile(profileRow ?? null);
    setRoles((roleRows ?? []).map((r) => r.role));
  }

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session?.user) {
        await loadProfileAndRoles(data.session.user.id);
      }
      if (active) setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!active) return;
      setSession(newSession);
      if (newSession?.user) {
        await loadProfileAndRoles(newSession.user.id);
        // Phase 5 (05-BACKEND.md §3) will call the `register-session` Edge Function here on
        // event === "SIGNED_IN" to enforce the concurrent-session cap. Not wired yet —
        // login_sessions/app_settings don't exist until that phase's migration lands.
        void event;
      } else {
        setProfile(null);
        setRoles([]);
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function refreshProfile() {
    if (session?.user) await loadProfileAndRoles(session.user.id);
  }

  const value: AuthContextValue = {
    user: session?.user ?? null,
    session,
    profile,
    roles,
    isAdmin: roles.includes("admin"),
    isModerator: roles.includes("moderator"),
    isSuspended: profile?.status === "suspended",
    loading,
    signOut,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

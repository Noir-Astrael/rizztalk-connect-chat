import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";

export type Role = "owner" | "admin";

export type AdminAuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "not_admin" }
  | { status: "admin"; session: Session; email: string; role: Role };

export function useAdminAuth(): AdminAuthState {
  const [state, setState] = useState<AdminAuthState>({ status: "loading" });

  useEffect(() => {
    let mounted = true;

    async function check(session: Session | null) {
      if (!session) {
        if (mounted) setState({ status: "unauthenticated" });
        return;
      }
      // Verify admin/owner role via roles RPC
      const [{ data: stats, error: statsErr }, { data: rolesData }] = await Promise.all([
        supabase.rpc("admin_dashboard_stats"),
        supabase
          .from("user_roles")
          .select("role, profiles!inner(auth_user_id)")
          .eq("profiles.auth_user_id", session.user.id),
      ]);
      if (statsErr || stats === null) {
        if (mounted) setState({ status: "not_admin" });
        return;
      }
      const roles = (rolesData ?? []).map((r: { role: string }) => r.role);
      const role: Role = roles.includes("owner") ? "owner" : "admin";
      if (mounted) {
        setState({ status: "admin", session, email: session.user.email ?? "", role });
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => check(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => check(session),
    );
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  return state;
}

export async function adminSignIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function adminSignOut() {
  return supabase.auth.signOut();
}

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

      // Verify admin access via dashboard stats RPC (is_admin() check server-side)
      const { data: stats, error: statsErr } = await supabase.rpc("admin_dashboard_stats");
      if (statsErr || stats === null) {
        if (mounted) setState({ status: "not_admin" });
        return;
      }

      // Determine role: use is_owner() RPC (SECURITY DEFINER, reliable for web auth)
      // plus fallback to user_roles table query
      let role: Role = "admin";
      const { data: isOwnerResult, error: ownerErr } = await supabase.rpc("is_owner");
      if (!ownerErr && isOwnerResult === true) {
        role = "owner";
      } else if (ownerErr) {
        // Fallback: query user_roles table directly
        const { data: rolesData } = await supabase
          .from("user_roles")
          .select("role, profiles!inner(auth_user_id)")
          .eq("profiles.auth_user_id", session.user.id);
        const roles = (rolesData ?? []).map((r: { role: string }) => r.role);
        if (roles.includes("owner")) {
          role = "owner";
        }
      }

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

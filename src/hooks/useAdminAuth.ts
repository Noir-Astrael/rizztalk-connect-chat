import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";

export type AdminAuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "not_admin" }
  | { status: "admin"; session: Session; email: string };

export function useAdminAuth(): AdminAuthState {
  const [state, setState] = useState<AdminAuthState>({ status: "loading" });

  useEffect(() => {
    let mounted = true;

    async function check(session: Session | null) {
      if (!session) {
        if (mounted) setState({ status: "unauthenticated" });
        return;
      }

      // Verify admin role by checking user_roles via RPC
      const { data, error } = await supabase.rpc("admin_dashboard_stats");
      if (error || data === null) {
        // If we can't call admin RPC, user is not an admin
        if (mounted) setState({ status: "not_admin" });
        return;
      }

      if (mounted) {
        setState({
          status: "admin",
          session,
          email: session.user.email ?? "",
        });
      }
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => check(session));

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => check(session),
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return state;
}

export async function adminSignIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function adminSignOut() {
  return supabase.auth.signOut();
}

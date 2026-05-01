import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAdminAuth, adminSignOut } from "@/hooks/useAdminAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  Crown, Users, Eye, RefreshCw, LogOut, UserPlus, Trash2, MessageSquare,
  CreditCard, ShieldCheck, Activity, CheckCircle2, XCircle, Loader2, Sparkles,
} from "lucide-react";
import { toast } from "sonner";

type AdminRow = {
  profile_id: string;
  email: string | null;
  alias: string;
  last_login_at: string | null;
  password_changed_at: string | null;
  password_expires_at: string | null;
  is_owner: boolean;
};

type SessionRow = {
  conversation_id: string;
  started_at: string;
  user_a_alias: string;
  user_a_tg: number;
  user_b_alias: string;
  user_b_tg: number;
  message_count: number;
  last_message_at: string | null;
};

type SessionMessage = {
  id: string;
  sender_alias: string;
  sender_tg: number;
  content: string;
  created_at: string;
};

type PaymentRow = {
  id: string;
  reference_code: string;
  payment_kind: string;
  plan: string;
  amount_idr: number;
  extracted_amount_idr: number | null;
  status: string;
  created_at: string;
  ai_validation: { matched?: boolean; confidence?: number; note?: string; diff?: number } | null;
  profiles: { alias: string; telegram_user_id: number } | null;
};

export default function OwnerDashboard() {
  const auth = useAdminAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"overview" | "admins" | "sessions" | "payments">("overview");
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(false);
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [openSession, setOpenSession] = useState<SessionRow | null>(null);
  const [sessionMsgs, setSessionMsgs] = useState<SessionMessage[]>([]);

  useEffect(() => {
    if (auth.status === "unauthenticated" || auth.status === "not_admin") {
      navigate("/admin/login");
    } else if (auth.status === "admin" && auth.role !== "owner") {
      toast.error("Hanya owner yang dapat mengakses halaman ini.");
      navigate("/admin");
    }
  }, [auth, navigate]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, a, ses, pay] = await Promise.all([
        supabase.rpc("admin_dashboard_stats"),
        supabase.rpc("list_admins"),
        supabase.rpc("owner_active_sessions"),
        supabase
          .from("payment_requests")
          .select("id, reference_code, payment_kind, plan, amount_idr, extracted_amount_idr, status, created_at, ai_validation, profiles(alias, telegram_user_id)")
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      setStats((s.data as Record<string, number>) ?? null);
      setAdmins((a.data as AdminRow[]) ?? []);
      setSessions((ses.data as SessionRow[]) ?? []);
      setPayments((pay.data as unknown as PaymentRow[]) ?? []);
    } catch (e) {
      console.error(e);
      toast.error("Gagal memuat data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (auth.status === "admin" && auth.role === "owner") refresh();
  }, [auth, refresh]);

  // Auto-refresh sessions every 10s when on sessions tab
  useEffect(() => {
    if (tab !== "sessions") return;
    const i = setInterval(async () => {
      const { data } = await supabase.rpc("owner_active_sessions");
      setSessions((data as SessionRow[]) ?? []);
    }, 10_000);
    return () => clearInterval(i);
  }, [tab]);

  // Auto-refresh open session messages every 5s
  useEffect(() => {
    if (!openSession) return;
    const load = async () => {
      const { data } = await supabase.rpc("owner_session_messages", {
        _conversation_id: openSession.conversation_id,
        _limit: 100,
      });
      setSessionMsgs(((data as SessionMessage[]) ?? []).reverse());
    };
    load();
    const i = setInterval(load, 5_000);
    return () => clearInterval(i);
  }, [openSession]);

  async function addAdmin() {
    const email = newAdminEmail.trim().toLowerCase();
    if (!email) return;
    const { data, error } = await supabase.rpc("add_admin_role", { _target_email: email });
    if (error) { toast.error(error.message); return; }
    const ok = (data as { ok?: boolean })?.ok;
    if (!ok) {
      toast.error((data as { error?: string })?.error ?? "Gagal menambah admin.");
      return;
    }
    toast.success(`Admin ${email} ditambahkan.`);
    setNewAdminEmail("");
    refresh();
  }

  async function removeAdmin(email: string) {
    if (!confirm(`Hapus admin ${email}?`)) return;
    const { data, error } = await supabase.rpc("remove_admin_role", { _target_email: email });
    if (error) { toast.error(error.message); return; }
    if (!(data as { ok?: boolean })?.ok) {
      toast.error((data as { error?: string })?.error ?? "Gagal.");
      return;
    }
    toast.success("Admin dihapus.");
    refresh();
  }

  async function approvePayment(p: PaymentRow) {
    const fn = p.payment_kind === "unban" ? "approve_unban_payment" : "approve_premium_payment";
    const { error } = await supabase.rpc(fn, { _reference_code: p.reference_code });
    if (error) { toast.error(error.message); return; }
    toast.success("Pembayaran disetujui.");
    refresh();
  }

  async function rejectPayment(p: PaymentRow) {
    const fn = p.payment_kind === "unban" ? "reject_unban_payment" : "reject_premium_payment";
    const note = prompt("Alasan penolakan (opsional):") ?? null;
    const { error } = await supabase.rpc(fn, { _reference_code: p.reference_code, _admin_note: note });
    if (error) { toast.error(error.message); return; }
    toast.success("Pembayaran ditolak.");
    refresh();
  }

  if (auth.status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  // If authenticated but not owner, the useEffect will handle the redirect
  if (auth.status === "admin" && auth.role !== "owner") return null;
  if (auth.status !== "admin") return null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/40 sticky top-0 z-30 bg-background/80 backdrop-blur">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-yellow-400 to-orange-500">
              <Crown className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-display font-bold text-lg">Owner Dashboard</h1>
              <p className="text-xs text-muted-foreground">{auth.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/admin" className="text-sm px-3 py-2 rounded-xl border border-border/50 hover:border-primary/40">Admin View</Link>
            <button onClick={refresh} disabled={loading} className="p-2 rounded-xl border border-border/50 hover:border-primary/40">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button onClick={async () => { await adminSignOut(); navigate("/admin/login"); }} className="p-2 rounded-xl border border-border/50 hover:border-red-400/40 hover:text-red-400">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
        <nav className="max-w-[1400px] mx-auto px-6 flex gap-1 -mb-px">
          {([
            ["overview", "Overview", Activity],
            ["admins", "Manage Admin", Users],
            ["sessions", "Live Sessions", Eye],
            ["payments", "Payments", CreditCard],
          ] as const).map(([k, label, Icon]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 flex items-center gap-2 transition ${
                tab === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 py-8 space-y-6">
        {tab === "overview" && stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {([
              ["Total Pengguna", stats.total_users, Users],
              ["Premium Aktif", stats.premium_users, Sparkles],
              ["Sesi Aktif", stats.active_chats, MessageSquare],
              ["Pending Premium", stats.pending_payments, CreditCard],
              ["Pending Unban", stats.pending_unbans, ShieldCheck],
              ["Disetujui Premium", stats.approved_payments, CheckCircle2],
              ["Disetujui Unban", stats.approved_unbans, CheckCircle2],
              ["Webhook Errors 24j", stats.webhook_errors_24h, XCircle],
            ] as Array<[string, number, React.ElementType]>).map(([label, val, Icon]) => (
              <div key={label} className="glass-card rounded-2xl p-5 border border-border/40">
                <Icon className="w-5 h-5 text-primary mb-3" />
                <p className="text-2xl font-bold tabular-nums">{Number(val ?? 0).toLocaleString()}</p>
                <p className="text-sm text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        )}

        {tab === "admins" && (
          <section className="space-y-4">
            <div className="glass-card rounded-2xl p-5 border border-border/40">
              <h2 className="font-semibold mb-3 flex items-center gap-2"><UserPlus className="w-4 h-4" /> Tambah Admin</h2>
              <p className="text-xs text-muted-foreground mb-3">User harus signup di /admin/login dulu, lalu masukkan email-nya di sini.</p>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={newAdminEmail}
                  onChange={(e) => setNewAdminEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="flex-1 px-3 py-2 rounded-xl bg-muted/50 border border-border/60 text-sm"
                />
                <button onClick={addAdmin} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium">
                  Tambah
                </button>
              </div>
            </div>
            <div className="glass-card rounded-2xl border border-border/40 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/20 border-b border-border/40">
                  <tr>
                    {["Email", "Alias", "Role", "Login Terakhir", "Password Expire", "Aksi"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {admins.map((a) => (
                    <tr key={a.profile_id}>
                      <td className="px-4 py-3 font-mono text-xs">{a.email ?? "—"}</td>
                      <td className="px-4 py-3">{a.alias}</td>
                      <td className="px-4 py-3">
                        {a.is_owner ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-400/15 text-yellow-400 border border-yellow-400/30">owner</span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-400/15 text-blue-400 border border-blue-400/30">admin</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {a.last_login_at ? new Date(a.last_login_at).toLocaleString("id-ID") : "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {a.password_expires_at ? new Date(a.password_expires_at).toLocaleDateString("id-ID") : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {!a.is_owner && a.email && (
                          <button onClick={() => removeAdmin(a.email!)} className="text-red-400 hover:text-red-300 p-1">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {admins.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">Belum ada admin.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === "sessions" && (
          <section className="space-y-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Eye className="w-3 h-3" />
              Read-only realtime monitoring · auto-refresh 10s · pengguna tidak diberi tahu (sesuai pilihan owner).
            </div>
            <div className="grid lg:grid-cols-2 gap-4">
              <div className="glass-card rounded-2xl border border-border/40 overflow-hidden">
                <div className="px-4 py-3 border-b border-border/40 bg-muted/20">
                  <h3 className="font-semibold text-sm">Sesi Aktif ({sessions.length})</h3>
                </div>
                <div className="max-h-[600px] overflow-y-auto divide-y divide-border/30">
                  {sessions.map((s) => (
                    <button
                      key={s.conversation_id}
                      onClick={() => setOpenSession(s)}
                      className={`w-full text-left px-4 py-3 hover:bg-muted/20 transition ${openSession?.conversation_id === s.conversation_id ? "bg-primary/5" : ""}`}
                    >
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{s.user_a_alias} ↔ {s.user_b_alias}</span>
                        <span className="text-xs text-muted-foreground">{s.message_count} msg</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Mulai: {new Date(s.started_at).toLocaleTimeString("id-ID")}
                        {s.last_message_at && ` · Terakhir: ${new Date(s.last_message_at).toLocaleTimeString("id-ID")}`}
                      </p>
                    </button>
                  ))}
                  {sessions.length === 0 && (
                    <p className="px-4 py-8 text-center text-muted-foreground text-sm">Tidak ada sesi aktif.</p>
                  )}
                </div>
              </div>
              <div className="glass-card rounded-2xl border border-border/40 overflow-hidden flex flex-col">
                <div className="px-4 py-3 border-b border-border/40 bg-muted/20 flex items-center justify-between">
                  <h3 className="font-semibold text-sm">
                    {openSession ? `${openSession.user_a_alias} ↔ ${openSession.user_b_alias}` : "Pilih sesi untuk lihat pesan"}
                  </h3>
                  {openSession && <button onClick={() => setOpenSession(null)} className="text-xs text-muted-foreground hover:text-foreground">Tutup</button>}
                </div>
                <div className="max-h-[600px] overflow-y-auto p-4 space-y-2 text-sm">
                  {openSession ? (
                    sessionMsgs.length > 0 ? sessionMsgs.map((m) => (
                      <div key={m.id} className="border-l-2 border-border/40 pl-3 py-1">
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{m.sender_alias}</span> · {new Date(m.created_at).toLocaleTimeString("id-ID")}
                        </p>
                        <p className="text-sm break-words">{m.content}</p>
                      </div>
                    )) : <p className="text-center text-muted-foreground text-xs py-8">Belum ada pesan.</p>
                  ) : <p className="text-center text-muted-foreground text-xs py-8">Klik salah satu sesi di kiri.</p>}
                </div>
              </div>
            </div>
          </section>
        )}

        {tab === "payments" && (
          <section className="glass-card rounded-2xl border border-border/40 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/20 border-b border-border/40">
                  <tr>
                    {["Kode", "User", "Jenis", "Diminta", "Diekstrak (AI)", "Status", "AI", "Tanggal", "Aksi"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {payments.map((p) => {
                    const ai = p.ai_validation;
                    const aiOk = ai?.matched;
                    return (
                      <tr key={p.id} className="hover:bg-muted/10">
                        <td className="px-4 py-3 font-mono text-xs text-primary">{p.reference_code}</td>
                        <td className="px-4 py-3">
                          <span className="font-medium">{p.profiles?.alias ?? "—"}</span>
                          <span className="text-muted-foreground text-xs ml-1">tg={p.profiles?.telegram_user_id ?? ""}</span>
                        </td>
                        <td className="px-4 py-3 capitalize">
                          <span className={`px-2 py-0.5 rounded-full text-xs border ${p.payment_kind === "unban" ? "bg-orange-400/15 text-orange-400 border-orange-400/30" : "bg-yellow-400/15 text-yellow-400 border-yellow-400/30"}`}>
                            {p.payment_kind} · {p.plan}
                          </span>
                        </td>
                        <td className="px-4 py-3 tabular-nums">Rp{p.amount_idr.toLocaleString("id-ID")}</td>
                        <td className="px-4 py-3 tabular-nums text-xs">
                          {p.extracted_amount_idr != null
                            ? <>Rp{p.extracted_amount_idr.toLocaleString("id-ID")}{ai?.diff != null && ai.diff < 0 && <span className="text-red-400 ml-1">(kurang Rp{(-ai.diff).toLocaleString("id-ID")})</span>}</>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3"><span className="text-xs px-2 py-0.5 rounded-full bg-muted">{p.status}</span></td>
                        <td className="px-4 py-3">
                          {ai ? (
                            <span className={`text-xs px-2 py-0.5 rounded-full border ${aiOk ? "bg-emerald-400/15 text-emerald-400 border-emerald-400/30" : "bg-red-400/15 text-red-400 border-red-400/30"}`} title={ai.note ?? ""}>
                              {aiOk ? "✓ match" : "✗ mismatch"} ({Math.round((ai.confidence ?? 0) * 100)}%)
                            </span>
                          ) : <span className="text-muted-foreground text-xs">belum</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(p.created_at).toLocaleString("id-ID")}</td>
                        <td className="px-4 py-3">
                          {p.status === "pending" && (
                            <div className="flex gap-1">
                              <button onClick={() => approvePayment(p)} className="text-xs px-2 py-1 rounded-lg bg-emerald-400/15 text-emerald-400 hover:bg-emerald-400/25">Approve</button>
                              <button onClick={() => rejectPayment(p)} className="text-xs px-2 py-1 rounded-lg bg-red-400/15 text-red-400 hover:bg-red-400/25">Reject</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {payments.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground text-sm">Tidak ada pembayaran.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

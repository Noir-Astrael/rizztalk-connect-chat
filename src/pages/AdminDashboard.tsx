import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAdminAuth, adminSignOut } from "@/hooks/useAdminAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  Users, MessageSquare, Star, Ban, ShieldAlert,
  CreditCard, Clock, BarChart2, LogOut, RefreshCw,
  TrendingUp, Activity, Zap, CheckCircle, XCircle,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Legend,
} from "recharts";

// ─── Types ──────────────────────────────────────────────────────────────────

interface DashboardStats {
  total_users: number;
  premium_users: number;
  banned_users: number;
  active_chats: number;
  total_conversations: number;
  pending_payments: number;
  approved_payments: number;
  rejected_payments: number;
  reports_24h: number;
  bot_signals_24h: number;
  queue_waiting: number;
}

interface DailyRow { day: string; count: number }
interface PaymentRow {
  id: string;
  reference_code: string;
  plan: string;
  amount_idr: number;
  status: string;
  created_at: string;
  proof_note: string | null;
  profiles: { alias: string; telegram_user_id: number } | null;
}
interface BanRow {
  id: string;
  alias: string;
  telegram_user_id: number;
  trust_score: number;
  is_banned_until: string;
  ban_reason: string | null;
}
interface ReportRow {
  id: string;
  reason: string;
  status: string;
  created_at: string;
  reporter: { alias: string } | null;
  reported: { alias: string; telegram_user_id: number } | null;
}

// ─── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon, label, value, sub, color = "primary",
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  sub?: string;
  color?: "primary" | "cyan" | "magenta" | "yellow" | "red" | "green";
}) {
  const colorMap: Record<string, string> = {
    primary: "text-primary bg-primary/10 border-primary/20",
    cyan: "text-cyan-400 bg-cyan-400/10 border-cyan-400/20",
    magenta: "text-pink-400 bg-pink-400/10 border-pink-400/20",
    yellow: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
    red: "text-red-400 bg-red-400/10 border-red-400/20",
    green: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  };
  return (
    <div className="glass-card rounded-2xl p-5 border border-border/40 hover:border-border/70 transition-all duration-300 group">
      <div className="flex items-start justify-between mb-4">
        <div className={`p-2.5 rounded-xl border ${colorMap[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <p className="text-2xl font-bold font-display tabular-nums">{value.toLocaleString()}</p>
      <p className="text-sm font-medium text-foreground/80 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function Badge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-yellow-400/15 text-yellow-400 border-yellow-400/30",
    approved: "bg-emerald-400/15 text-emerald-400 border-emerald-400/30",
    rejected: "bg-red-400/15 text-red-400 border-red-400/30",
    reviewed: "bg-blue-400/15 text-blue-400 border-blue-400/30",
    dismissed: "bg-muted text-muted-foreground border-border",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${map[status] ?? "bg-muted text-muted-foreground border-border"}`}>
      {status}
    </span>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, count }: { icon: React.ElementType; title: string; count?: number }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="p-2 rounded-lg bg-primary/10">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <h2 className="font-semibold text-lg">{title}</h2>
      {count !== undefined && (
        <span className="ml-auto text-xs text-muted-foreground font-mono">{count} item</span>
      )}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const navigate = useNavigate();
  const auth = useAdminAuth();

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [convChart, setConvChart] = useState<DailyRow[]>([]);
  const [signupChart, setSignupChart] = useState<DailyRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [bans, setBans] = useState<BanRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  // Redirect if not authenticated or not admin
  useEffect(() => {
    if (auth.status === "unauthenticated") navigate("/admin/login");
    if (auth.status === "not_admin") navigate("/admin/login");
  }, [auth.status, navigate]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [
        { data: statsData },
        { data: convData },
        { data: signupData },
        { data: paymentsData },
        { data: bansData },
        { data: reportsData },
      ] = await Promise.all([
        supabase.rpc("admin_dashboard_stats"),
        supabase.rpc("admin_daily_conversations", { _days: 30 }),
        supabase.rpc("admin_daily_signups", { _days: 30 }),
        supabase
          .from("payment_requests")
          .select("id, reference_code, plan, amount_idr, status, created_at, proof_note, profiles(alias, telegram_user_id)")
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("profiles")
          .select("id, alias, telegram_user_id, trust_score, is_banned_until, ban_reason")
          .not("is_banned_until", "is", null)
          .gt("is_banned_until", new Date().toISOString())
          .order("is_banned_until", { ascending: false })
          .limit(20),
        supabase
          .from("user_reports")
          .select("id, reason, status, created_at, reporter:reporter_id(alias), reported:reported_id(alias, telegram_user_id)")
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

      if (statsData) setStats(statsData as unknown as DashboardStats);
      if (convData) setConvChart((convData as DailyRow[]).map(r => ({ day: r.day?.slice(5) ?? r.day, count: Number(r.count) })));
      if (signupData) setSignupChart((signupData as DailyRow[]).map(r => ({ day: r.day?.slice(5) ?? r.day, count: Number(r.count) })));
      if (paymentsData) setPayments(paymentsData as unknown as PaymentRow[]);
      if (bansData) setBans(bansData as unknown as BanRow[]);
      if (reportsData) setReports(reportsData as unknown as ReportRow[]);

      setLastRefresh(new Date());
    } catch (e) {
      console.error("Dashboard fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (auth.status === "admin") fetchData();
  }, [auth.status, fetchData]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    if (auth.status !== "admin") return;
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [auth.status, fetchData]);

  async function handleSignOut() {
    await adminSignOut();
    navigate("/admin/login");
  }

  if (auth.status === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          Memuat…
        </div>
      </div>
    );
  }

  if (auth.status !== "admin") return null;

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 w-64 glass-card border-r border-border/50 flex flex-col z-40 hidden lg:flex">
        <div className="p-6 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-primary">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-display font-bold text-base">RizzTalk</p>
              <p className="text-xs text-muted-foreground">Admin Panel</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {[
            { icon: BarChart2, label: "Overview" },
            { icon: TrendingUp, label: "Grafik" },
            { icon: CreditCard, label: "Pembayaran" },
            { icon: Ban, label: "User Banned" },
            { icon: ShieldAlert, label: "Laporan" },
          ].map(({ icon: Icon, label }) => (
            <a
              key={label}
              href={`#${label.toLowerCase()}`}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-200"
            >
              <Icon className="w-4 h-4" />
              {label}
            </a>
          ))}
        </nav>

        <div className="p-4 border-t border-border/40">
          <div className="px-3 py-2 mb-2">
            <p className="text-xs text-muted-foreground truncate">{auth.email}</p>
          </div>
          <button
            id="admin-signout-btn"
            onClick={handleSignOut}
            className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-all duration-200"
          >
            <LogOut className="w-4 h-4" />
            Keluar
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="lg:ml-64 p-6 space-y-8 max-w-[1400px]">
        {/* Header */}
        <div className="flex items-center justify-between pt-2">
          <div>
            <h1 className="font-display font-bold text-2xl">Dashboard Admin</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Update terakhir: {lastRefresh.toLocaleTimeString("id-ID")}
            </p>
          </div>
          <button
            id="admin-refresh-btn"
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl glass-card border border-border/50 text-sm hover:border-primary/40 transition-all disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {/* Stats cards */}
        <section id="overview">
          <SectionHeader icon={Activity} title="Overview" />
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
            <StatCard icon={Users} label="Total Pengguna" value={stats?.total_users ?? "—"} color="primary" />
            <StatCard icon={MessageSquare} label="Percakapan Aktif" value={stats?.active_chats ?? "—"} sub={`${stats?.total_conversations?.toLocaleString() ?? 0} total`} color="cyan" />
            <StatCard icon={Star} label="User Premium" value={stats?.premium_users ?? "—"} color="yellow" />
            <StatCard icon={Ban} label="User Banned" value={stats?.banned_users ?? "—"} color="red" />
            <StatCard icon={CreditCard} label="Pembayaran Pending" value={stats?.pending_payments ?? "—"} color="magenta" />
            <StatCard icon={CheckCircle} label="Pembayaran Disetujui" value={stats?.approved_payments ?? "—"} color="green" />
            <StatCard icon={ShieldAlert} label="Report 24 Jam" value={stats?.reports_24h ?? "—"} color="red" />
            <StatCard icon={Clock} label="Antrian" value={stats?.queue_waiting ?? "—"} sub="menunggu match" color="cyan" />
          </div>
        </section>

        {/* Charts */}
        <section id="grafik">
          <SectionHeader icon={TrendingUp} title="Grafik Aktivitas (30 Hari)" />
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="glass-card rounded-2xl p-5 border border-border/40">
              <p className="text-sm font-medium text-muted-foreground mb-4">Percakapan Harian</p>
              {convChart.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={convChart} margin={{ top: 0, right: 8, bottom: 0, left: -20 }}>
                    <defs>
                      <linearGradient id="gradConv" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                    <XAxis dataKey="day" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px", fontSize: 12 }}
                      labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
                    />
                    <Area type="monotone" dataKey="count" stroke="hsl(var(--primary))" fill="url(#gradConv)" strokeWidth={2} name="Percakapan" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">Belum ada data</div>
              )}
            </div>

            <div className="glass-card rounded-2xl p-5 border border-border/40">
              <p className="text-sm font-medium text-muted-foreground mb-4">Pendaftar Baru Harian</p>
              {signupChart.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={signupChart} margin={{ top: 0, right: 8, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                    <XAxis dataKey="day" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px", fontSize: 12 }}
                      labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
                    />
                    <Bar dataKey="count" fill="hsl(var(--secondary))" radius={[4, 4, 0, 0]} name="Pendaftar" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">Belum ada data</div>
              )}
            </div>
          </div>
        </section>

        {/* Payments table */}
        <section id="pembayaran">
          <SectionHeader icon={CreditCard} title="Pembayaran Terbaru" count={payments.length} />
          <div className="glass-card rounded-2xl border border-border/40 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    {["Kode", "User", "Plan", "Nominal", "Status", "Bukti", "Tanggal"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {payments.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">Tidak ada pembayaran</td></tr>
                  ) : payments.map((p) => (
                    <tr key={p.id} className="hover:bg-muted/10 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-primary">{p.reference_code}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-medium">{(p.profiles as { alias: string } | null)?.alias ?? "—"}</span>
                        <span className="text-muted-foreground text-xs ml-1">tg={((p.profiles as { telegram_user_id: number } | null)?.telegram_user_id ?? "")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground capitalize">{p.plan}</td>
                      <td className="px-4 py-3 tabular-nums whitespace-nowrap">Rp {Number(p.amount_idr).toLocaleString("id-ID")}</td>
                      <td className="px-4 py-3"><Badge status={p.status} /></td>
                      <td className="px-4 py-3 max-w-[160px]">
                        <span className="text-xs text-muted-foreground truncate block" title={p.proof_note ?? undefined}>
                          {p.proof_note ? p.proof_note.slice(0, 50) + (p.proof_note.length > 50 ? "…" : "") : <span className="text-red-400/70">Belum dikirim</span>}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                        {new Date(p.created_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Bans table */}
        <section id="user-banned">
          <SectionHeader icon={Ban} title="User Banned Aktif" count={bans.length} />
          <div className="glass-card rounded-2xl border border-border/40 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    {["Alias", "Telegram ID", "Trust", "Ban Sampai", "Alasan"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {bans.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">Tidak ada user banned saat ini 🎉</td></tr>
                  ) : bans.map((b) => (
                    <tr key={b.id} className="hover:bg-muted/10 transition-colors">
                      <td className="px-4 py-3 font-medium">{b.alias}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{b.telegram_user_id}</td>
                      <td className="px-4 py-3">
                        <span className={`font-bold tabular-nums ${b.trust_score < 30 ? "text-red-400" : b.trust_score < 60 ? "text-yellow-400" : "text-emerald-400"}`}>
                          {b.trust_score}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-red-400 whitespace-nowrap text-xs">
                        {new Date(b.is_banned_until).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs max-w-[220px]">
                        <span className="truncate block" title={b.ban_reason ?? undefined}>{b.ban_reason ?? "—"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Reports table */}
        <section id="laporan" className="pb-8">
          <SectionHeader icon={ShieldAlert} title="Laporan Terbaru" count={reports.length} />
          <div className="glass-card rounded-2xl border border-border/40 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    {["Pelapor", "Dilaporkan", "Alasan", "Status", "Waktu"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {reports.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">Tidak ada laporan</td></tr>
                  ) : reports.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/10 transition-colors">
                      <td className="px-4 py-3 font-medium">{(r.reporter as { alias: string } | null)?.alias ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className="font-medium">{(r.reported as { alias: string } | null)?.alias ?? "—"}</span>
                        <span className="text-muted-foreground text-xs ml-1">tg={(r.reported as { telegram_user_id: number } | null)?.telegram_user_id ?? ""}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="capitalize font-mono text-xs px-2 py-0.5 rounded bg-muted/50">{r.reason}</span>
                      </td>
                      <td className="px-4 py-3"><Badge status={r.status} /></td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                        {new Date(r.created_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

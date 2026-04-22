const layers = [
  {
    n: "01",
    title: "Client",
    tech: "Telegram Bot UI",
    desc: "Tanpa app install — user pakai Telegram langsung. Onboarding cepat via inline keyboard.",
  },
  {
    n: "02",
    title: "Edge Functions",
    tech: "Deno + Lovable Cloud",
    desc: "telegram-webhook (instant), telegram-poll (fallback), ai-fallback-sweep (cron).",
  },
  {
    n: "03",
    title: "Matching Engine",
    tech: "TypeScript + RPC",
    desc: "Skor: provinsi, gender, minat, trust. Anti-starvation lewat wait boost & filter relax.",
  },
  {
    n: "04",
    title: "Storage",
    tech: "PostgreSQL + RLS",
    desc: "Pesan auto-purge 1 jam setelah sesi end. Profiles, trust_events, payment_requests, bot_signals.",
  },
  {
    n: "05",
    title: "AI Companion",
    tech: "Lovable AI · Gemini Flash",
    desc: "Aktif setelah 60 detik sepi — transparan, bot detection real-time pakai classifier sample.",
  },
  {
    n: "06",
    title: "Payment",
    tech: "Manual Transfer + Admin",
    desc: "Kode unik per request, /admin approve/reject, otomatis grant premium 30 hari.",
  },
];

export const Architecture = () => (
  <section id="arsitektur" className="py-24 sm:py-32 relative overflow-hidden">
    <div className="absolute inset-0 grid-pattern opacity-30" aria-hidden />
    <div className="absolute inset-0 bg-gradient-to-b from-background via-transparent to-background" aria-hidden />

    <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative">
      <div className="max-w-2xl mb-16">
        <p className="font-mono text-sm text-accent mb-4 uppercase tracking-wider">
          03 — Arsitektur
        </p>
        <h2 className="font-display font-bold text-4xl sm:text-5xl tracking-tight mb-4">
          Microservices stack,
          <br />
          <span className="text-gradient">low-latency</span> by design.
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-border rounded-3xl overflow-hidden">
        {layers.map((l) => (
          <div
            key={l.n}
            className="bg-card p-7 hover:bg-muted/40 transition-colors duration-500 group"
          >
            <div className="flex items-start justify-between mb-4">
              <span className="font-mono text-xs text-muted-foreground">
                {l.n}
              </span>
              <span className="font-mono text-xs px-2 py-1 rounded-md border border-border text-muted-foreground group-hover:text-primary group-hover:border-primary/50 transition-colors">
                {l.tech}
              </span>
            </div>
            <h3 className="font-display font-semibold text-2xl mb-2">
              {l.title}
            </h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {l.desc}
            </p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

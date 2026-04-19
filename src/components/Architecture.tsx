const layers = [
  {
    n: "01",
    title: "Frontend",
    tech: "React + Vite + TypeScript",
    desc: "UI responsif Bahasa Indonesia, WebSocket client, hCaptcha integration.",
  },
  {
    n: "02",
    title: "API Gateway",
    tech: "Golang + Gin",
    desc: "Routing, JWT verification (RS256), rate limiting per user/IP.",
  },
  {
    n: "03",
    title: "Chat Service",
    tech: "Golang Goroutines + WebSocket Hub",
    desc: "1 goroutine per koneksi WS, alias generator, matching engine.",
  },
  {
    n: "04",
    title: "Storage",
    tech: "PostgreSQL + Redis",
    desc: "Pesan AES-256-GCM, session state ephemeral di Redis.",
  },
  {
    n: "05",
    title: "AI Fallback",
    tech: "Anthropic Claude API",
    desc: "Aktif setelah 60 detik tanpa match — transparan ke user.",
  },
  {
    n: "06",
    title: "Payment",
    tech: "Midtrans + Manual Transfer",
    desc: "QRIS, VA, GoPay, OVO, Dana. Bukti transfer terenkripsi.",
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

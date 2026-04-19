const phases = [
  {
    phase: "Fase 1",
    when: "Bulan 1-2",
    title: "Foundation",
    items: ["Auth & user system", "Trust score core", "Admin dashboard MVP"],
  },
  {
    phase: "Fase 2",
    when: "Bulan 2-3",
    title: "Real-time Chat",
    items: ["WebSocket Hub", "Matching engine", "Alias generator"],
  },
  {
    phase: "Fase 3",
    when: "Bulan 3-4",
    title: "Monetization",
    items: ["Midtrans integration", "Manual transfer", "Premium tier"],
  },
  {
    phase: "Fase 4",
    when: "Bulan 5-6",
    title: "Intelligence",
    items: ["AI fallback Claude", "Bot detection NLP", "Auto moderation"],
  },
];

export const Roadmap = () => (
  <section id="roadmap" className="py-24 sm:py-32 relative">
    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mb-16">
        <p className="font-mono text-sm text-secondary mb-4 uppercase tracking-wider">
          05 — Roadmap
        </p>
        <h2 className="font-display font-bold text-4xl sm:text-5xl tracking-tight">
          Empat fase. Enam bulan.
          <br />
          <span className="text-gradient">Satu visi.</span>
        </h2>
      </div>

      <div className="relative">
        <div className="absolute left-0 right-0 top-1/2 h-px bg-gradient-to-r from-transparent via-border to-transparent hidden lg:block" aria-hidden />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 relative">
          {phases.map((p, i) => (
            <div key={p.phase} className="relative">
              <div className="glass-card glow-border rounded-3xl p-6 hover:-translate-y-1 transition-transform duration-500">
                <div className="flex items-center justify-between mb-4">
                  <span className="font-mono text-xs text-primary">
                    {p.phase}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {p.when}
                  </span>
                </div>
                <h3 className="font-display font-bold text-2xl mb-4">
                  {p.title}
                </h3>
                <ul className="space-y-2">
                  {p.items.map((item) => (
                    <li
                      key={item}
                      className="text-sm text-muted-foreground flex items-start gap-2"
                    >
                      <span className="w-1 h-1 rounded-full bg-gradient-primary mt-2 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              {i < phases.length - 1 && (
                <div className="hidden lg:block absolute top-1/2 -right-3 w-6 h-px bg-gradient-primary" aria-hidden />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);

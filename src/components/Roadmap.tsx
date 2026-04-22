const phases = [
  {
    phase: "Fase 1",
    when: "Selesai ✓",
    title: "Foundation",
    items: ["Telegram bot live", "Onboarding & profil", "Match engine + trust score"],
  },
  {
    phase: "Fase 2",
    when: "Selesai ✓",
    title: "Safety",
    items: ["Report & block", "Trust events history", "Auto-purge pesan 1 jam"],
  },
  {
    phase: "Fase 3",
    when: "Selesai ✓",
    title: "Intelligence",
    items: ["AI Companion (Gemini)", "Bot/spam/scam detection", "Rate limiting + admin tools"],
  },
  {
    phase: "Fase 4",
    when: "Berikutnya",
    title: "Scale",
    items: ["Midtrans QRIS/VA", "Premium gender filter", "Multi-region matching"],
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

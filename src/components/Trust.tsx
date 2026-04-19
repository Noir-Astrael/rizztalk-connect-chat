const rules = [
  { action: "Selesaikan sesi tanpa report", change: "+5", positive: true },
  { action: "Diberi rating positif lawan bicara", change: "+10", positive: true },
  { action: "Mendapat report ringan terverifikasi", change: "-10", positive: false },
  { action: "Mendapat report serius terverifikasi", change: "-20", positive: false },
  { action: "Terdeteksi bot dan dikonfirmasi", change: "-50", positive: false },
];

export const Trust = () => (
  <section id="trust" className="py-24 sm:py-32 relative">
    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
      <div className="grid lg:grid-cols-2 gap-12 items-start">
        <div className="lg:sticky lg:top-32">
          <p className="font-mono text-sm text-primary mb-4 uppercase tracking-wider">
            04 — Trust Score
          </p>
          <h2 className="font-display font-bold text-4xl sm:text-5xl tracking-tight mb-6">
            Reputasi yang{" "}
            <span className="text-gradient">memiliki konsekuensi</span> nyata.
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            Setiap user memiliki trust score yang berubah berdasarkan perilaku.
            Skor di bawah nol memicu ban otomatis. Sistem ini transparan,
            terukur, dan mendorong komunitas yang sehat tanpa pengawasan
            manual berlebihan.
          </p>

          <div className="mt-10 glass-card glow-border rounded-3xl p-8">
            <div className="flex items-baseline gap-3 mb-2">
              <span className="font-display font-bold text-6xl text-gradient">
                100
              </span>
              <span className="text-muted-foreground font-mono text-sm">
                / starting score
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full w-full bg-gradient-primary" />
            </div>
            <p className="text-xs text-muted-foreground mt-3 font-mono">
              skor &lt; 0 → ban otomatis
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {rules.map((r) => (
            <div
              key={r.action}
              className="glass-card rounded-2xl p-5 flex items-center justify-between gap-6 hover:border-primary/30 transition-colors duration-300"
            >
              <span className="text-sm sm:text-base">{r.action}</span>
              <span
                className={`font-mono font-bold text-lg shrink-0 ${
                  r.positive ? "text-primary" : "text-secondary"
                }`}
              >
                {r.change}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);

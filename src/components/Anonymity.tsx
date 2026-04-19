export const Anonymity = () => (
  <section id="anonim" className="py-24 sm:py-32 relative">
    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
      <div className="grid lg:grid-cols-2 gap-16 items-center">
        <div>
          <p className="font-mono text-sm text-secondary mb-4 uppercase tracking-wider">
            02 — Desain Anonimitas
          </p>
          <h2 className="font-display font-bold text-4xl sm:text-5xl tracking-tight mb-6">
            Dua lapisan identitas yang{" "}
            <span className="text-gradient">tidak pernah bertemu</span>.
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed mb-8">
            Anonimitas bukan fitur tambahan — ini fondasi arsitektur. Setiap
            keputusan teknis Rizztalk mempertimbangkan apakah ia bisa
            membocorkan identitas pengguna.
          </p>

          <div className="space-y-4">
            <div className="glass-card rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-2">
                <span className="font-mono text-xs px-2 py-1 rounded-md bg-primary/20 text-primary border border-primary/30">
                  PRIVATE
                </span>
                <h3 className="font-display font-semibold">Identitas Akun</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                UUID internal, email, username — hanya diketahui sistem & admin.
              </p>
            </div>
            <div className="glass-card rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-2">
                <span className="font-mono text-xs px-2 py-1 rounded-md bg-secondary/20 text-secondary border border-secondary/30">
                  PUBLIC
                </span>
                <h3 className="font-display font-semibold">Identitas Sesi</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Alias sementara per sesi — satu-satunya yang terlihat lawan
                bicara.
              </p>
            </div>
          </div>
        </div>

        {/* Chat preview mockup */}
        <div className="relative">
          <div className="absolute -inset-10 bg-gradient-primary opacity-20 blur-3xl rounded-full" aria-hidden />
          <div className="relative glass-card glow-border rounded-3xl p-6 shadow-elegant">
            <div className="flex items-center justify-between pb-4 border-b border-border mb-4">
              <div>
                <div className="font-display font-semibold">Berani Rusa 47</div>
                <div className="text-xs text-muted-foreground font-mono">
                  Jakarta · Online
                </div>
              </div>
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse-glow" />
            </div>

            <div className="space-y-3">
              <ChatBubble side="left" text="Halo! Apa kabar?" />
              <ChatBubble side="right" text="Baik. Lagi sibuk apa?" />
              <ChatBubble
                side="left"
                text="Lagi nyari teman ngobrol aja 😄"
              />
              <ChatBubble side="right" text="Sama, di sini juga!" />
              <div className="flex items-center gap-2 pt-2">
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full w-2/3 bg-gradient-primary animate-shimmer bg-[length:200%_auto]" />
                </div>
                <span className="text-xs text-muted-foreground font-mono">
                  typing...
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
);

const ChatBubble = ({
  side,
  text,
}: {
  side: "left" | "right";
  text: string;
}) => (
  <div className={`flex ${side === "right" ? "justify-end" : "justify-start"}`}>
    <div
      className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm ${
        side === "right"
          ? "bg-gradient-primary text-primary-foreground rounded-br-sm"
          : "bg-muted text-foreground rounded-bl-sm"
      }`}
    >
      {text}
    </div>
  </div>
);

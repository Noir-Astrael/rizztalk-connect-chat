import { ArrowRight, Send } from "lucide-react";
import { BOT_START_URL, BOT_USERNAME } from "@/config/bot";

export const CTA = () => (
  <section className="py-24 sm:py-32 relative">
    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
      <div className="relative glass-card glow-border rounded-[2.5rem] p-10 sm:p-16 text-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-primary opacity-10" aria-hidden />
        <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-gradient-primary opacity-20 blur-3xl rounded-full" aria-hidden />

        <div className="relative">
          <h2 className="font-display font-bold text-4xl sm:text-6xl tracking-tight mb-6 max-w-3xl mx-auto">
            Siap mulai{" "}
            <span className="text-gradient">obrolan tanpa batas</span>?
          </h2>
          <p className="text-muted-foreground text-lg mb-10 max-w-xl mx-auto">
            Buka Telegram, ketik <code className="font-mono text-foreground">/start</code> di
            bot Rizztalk. Anonim, gratis, langsung match.
          </p>
          <a
            href={BOT_START_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-2 px-8 py-4 rounded-full bg-gradient-primary text-primary-foreground font-semibold shadow-neon-cyan hover:shadow-neon-magenta transition-all duration-500 hover:scale-105"
          >
            <Send className="w-4 h-4" />
            Buka @{BOT_USERNAME}
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </a>
        </div>
      </div>
    </div>
  </section>
);

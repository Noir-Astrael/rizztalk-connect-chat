import heroBg from "@/assets/rizztalk-hero.jpg";
import { ArrowRight, Sparkles } from "lucide-react";

export const Hero = () => (
  <section
    id="top"
    className="relative min-h-screen flex items-center pt-32 pb-20 overflow-hidden"
  >
    {/* Background image */}
    <div className="absolute inset-0 -z-10">
      <img
        src={heroBg}
        alt=""
        aria-hidden
        width={1920}
        height={1280}
        className="w-full h-full object-cover opacity-40"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/80 to-background" />
    </div>

    {/* Floating glows */}
    <div className="absolute top-1/4 -left-20 w-96 h-96 rounded-full bg-primary/20 blur-3xl animate-float" aria-hidden />
    <div className="absolute bottom-1/4 -right-20 w-96 h-96 rounded-full bg-secondary/20 blur-3xl animate-float [animation-delay:2s]" aria-hidden />

    <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative">
      <div className="max-w-4xl mx-auto text-center animate-fade-up">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass-card mb-8">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-sm text-muted-foreground font-mono">
            White Paper v1.0 · 2025
          </span>
        </div>

        <h1 className="font-display font-bold text-5xl sm:text-6xl lg:text-8xl leading-[0.95] tracking-tight mb-6">
          Berbincang Bebas.
          <br />
          <span className="text-gradient">Tanpa Identitas.</span>
        </h1>

        <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
          Rizztalk adalah platform random chat anonim Indonesia.
          Match real-time berbasis lokasi, alias sesi otomatis, dan AI fallback
          — semua dalam satu pengalaman yang aman dan elegan.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <a
            id="cta"
            href="#fitur"
            className="group inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full bg-gradient-primary text-primary-foreground font-semibold shadow-neon-cyan hover:shadow-neon-magenta transition-all duration-500 hover:scale-105"
          >
            Mulai Sekarang
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </a>
          <a
            href="#arsitektur"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full glass-card hover:bg-muted/30 font-medium transition-all duration-300"
          >
            Baca White Paper
          </a>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 sm:gap-8 mt-20 max-w-2xl mx-auto">
          {[
            { v: "<60s", l: "Match time" },
            { v: "100%", l: "Anonim" },
            { v: "24/7", l: "AI fallback" },
          ].map((s) => (
            <div key={s.l} className="text-center">
              <div className="font-display font-bold text-3xl sm:text-4xl text-gradient">
                {s.v}
              </div>
              <div className="text-xs sm:text-sm text-muted-foreground mt-1 uppercase tracking-wider">
                {s.l}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);

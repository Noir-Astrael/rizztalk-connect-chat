import { Lock, MapPin, Bot, Shield, CreditCard, Search } from "lucide-react";
import { useReveal } from "@/hooks/useReveal";

const pillars = [
  {
    icon: Lock,
    title: "Anonimitas Penuh",
    desc: "Tidak ada username, foto profil, atau identitas yang terekspos saat chat.",
  },
  {
    icon: MapPin,
    title: "Matching Lokasi",
    desc: "Prioritas pertemuan antar user di provinsi/kota yang sama di Indonesia.",
  },
  {
    icon: Bot,
    title: "AI Fallback",
    desc: "Jika tidak ada user nyata dalam 60 detik, AI mengambil alih secara mulus.",
  },
  {
    icon: Shield,
    title: "Trust & Report",
    desc: "Poin kepercayaan yang mendorong perilaku positif, dengan konsekuensi nyata.",
  },
  {
    icon: CreditCard,
    title: "Payment Lokal",
    desc: "Transfer manual + Midtrans (QRIS, VA, GoPay, OVO, Dana).",
  },
  {
    icon: Search,
    title: "Deteksi Bot",
    desc: "Behavioral scoring real-time untuk melindungi komunitas dari akun otomatis.",
  },
];

export const Pillars = () => {
  const { ref, visible } = useReveal<HTMLDivElement>();
  return (
    <section id="fitur" className="py-24 sm:py-32 relative">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mb-16">
          <p className="font-mono text-sm text-primary mb-4 uppercase tracking-wider">
            01 — Pilar Utama
          </p>
          <h2 className="font-display font-bold text-4xl sm:text-5xl tracking-tight mb-4">
            Enam pilar yang membuat
            <br />
            Rizztalk <span className="text-gradient">berbeda</span>.
          </h2>
        </div>

        <div
          ref={ref}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
        >
          {pillars.map((p, i) => (
            <div
              key={p.title}
              className="group glass-card glow-border rounded-3xl p-7 hover:-translate-y-1 transition-all duration-500"
              style={{
                opacity: visible ? 1 : 0,
                transform: visible ? "translateY(0)" : "translateY(30px)",
                transition: `all 0.7s cubic-bezier(0.4,0,0.2,1) ${i * 80}ms`,
              }}
            >
              <div className="w-12 h-12 rounded-2xl bg-gradient-primary flex items-center justify-center mb-5 shadow-neon-cyan group-hover:shadow-neon-magenta transition-shadow duration-500">
                <p.icon className="w-6 h-6 text-primary-foreground" />
              </div>
              <h3 className="font-display font-semibold text-xl mb-2">
                {p.title}
              </h3>
              <p className="text-muted-foreground leading-relaxed text-sm">
                {p.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

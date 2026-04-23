import { Logo } from "./Logo";

const links = [
  { href: "#fitur", label: "Fitur" },
  { href: "#anonim", label: "Anonimitas" },
  { href: "#arsitektur", label: "Arsitektur" },
  { href: "#trust", label: "Trust" },
  { href: "#roadmap", label: "Roadmap" },
];

export const Navbar = () => (
  <header className="fixed top-0 inset-x-0 z-50">
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 mt-4">
      <nav className="glass-card rounded-full px-4 sm:px-6 py-3 flex items-center justify-between">
        <a href="#top" aria-label="RizzTalk home">
          <Logo />
        </a>
        <ul className="hidden md:flex items-center gap-7 text-sm text-muted-foreground">
          {links.map((l) => (
            <li key={l.href}>
              <a
                href={l.href}
                className="hover:text-foreground transition-colors duration-300"
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <a
            href="/admin/login"
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all duration-300"
          >
            Admin
          </a>
          <a
            href="#cta"
            className="relative inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-primary text-primary-foreground text-sm font-semibold shadow-neon-cyan hover:shadow-neon-magenta transition-all duration-500 hover:scale-105"
          >
            Mulai Chat
          </a>
        </div>
      </nav>
    </div>
  </header>
);

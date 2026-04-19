import { Logo } from "./Logo";

export const Footer = () => (
  <footer className="border-t border-border py-12 mt-12">
    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
      <div className="flex flex-col md:flex-row items-center justify-between gap-6">
        <Logo />
        <p className="text-sm text-muted-foreground font-mono">
          © 2025 Rizztalk · Berbincang Bebas. Tanpa Identitas.
        </p>
        <div className="flex gap-6 text-sm text-muted-foreground">
          <a href="#" className="hover:text-foreground transition-colors">Privacy</a>
          <a href="#" className="hover:text-foreground transition-colors">Terms</a>
          <a href="#" className="hover:text-foreground transition-colors">Contact</a>
        </div>
      </div>
    </div>
  </footer>
);

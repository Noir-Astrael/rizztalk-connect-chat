import logo from "@/assets/rizztalk-mark.png";

export const Logo = ({ size = 36 }: { size?: number }) => (
  <div className="flex items-center gap-2.5">
    <div className="relative">
      <div
        className="absolute inset-0 rounded-full blur-xl opacity-60 bg-gradient-primary"
        aria-hidden
      />
      <img
        src={logo}
        alt="Rizztalk logo"
        width={size}
        height={size}
        className="relative drop-shadow-[0_0_12px_hsl(var(--primary)/0.6)]"
      />
    </div>
    <span className="font-display font-bold text-xl tracking-tight">
      Rizz<span className="text-gradient">talk</span>
    </span>
  </div>
);

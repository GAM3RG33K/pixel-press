import { Minimize2 } from "lucide-react";
import { StatusPill } from "@/features/status/StatusPill";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-6">
        {/* Left: brand link */}
        <a href="/" className="inline-flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid place-items-center size-6 rounded-md bg-primary text-primary-foreground">
            <Minimize2 className="size-3.5" aria-hidden />
          </span>
          <span>pixel-press</span>
        </a>

        {/* Center/right: nav */}
        <nav className="hidden items-center gap-6 md:flex">
          <span className="hidden text-sm text-muted-foreground md:inline">Compress</span>
          <span className="hidden text-sm text-muted-foreground md:inline">Compare</span>
          <span className="hidden text-sm text-muted-foreground md:inline">Audit</span>
          <span className="hidden text-sm text-muted-foreground md:inline">Optimize</span>
        </nav>

        {/* Right: StatusPill */}
        <StatusPill />
      </div>
    </header>
  );
}
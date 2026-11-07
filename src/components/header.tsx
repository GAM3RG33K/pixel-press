import { StatusPill } from "@/features/status/StatusPill";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <a
          href="/"
          aria-label="pixel-press home"
          className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap font-semibold tracking-tight"
        >
          <img
            src="/icon.svg"
            alt=""
            width={28}
            height={28}
            className="size-7 rounded-md"
            aria-hidden
          />
          <span>pixel-press</span>
        </a>

        <nav className="hidden items-center gap-6 lg:flex">
          <span className="text-sm text-muted-foreground">Compress</span>
          <span className="text-sm text-muted-foreground">Compare</span>
          <span className="text-sm text-muted-foreground">Audit</span>
          <span className="text-sm text-muted-foreground">Optimize</span>
        </nav>

        <StatusPill />
      </div>
    </header>
  );
}

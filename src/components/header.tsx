import { StatusPill } from "@/features/status/StatusPill";
import { SettingsDrawer } from "@/components/settings-drawer";

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

        <div className="flex shrink-0 items-center gap-2">
          <StatusPill />
          <SettingsDrawer />
        </div>
      </div>
    </header>
  );
}
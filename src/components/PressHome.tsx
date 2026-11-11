import { Sparkles, ArrowRight, ShieldCheck } from "lucide-react";

import { PressDropZone, type PressRoute } from "@/components/PressDropZone";
import { cn } from "@/lib/utils";

export const GOALS = [
  { id: "smallest", label: "Smallest file", intent: "smallest possible file size, strip audio" },
  { id: "good-enough", label: "Good enough quality", intent: "good enough quality for everyday sharing" },
  { id: "social", label: "Social 1080p", intent: "social media 1080p" },
  { id: "crisp", label: "Keep it crisp", intent: "keep it crisp, near-lossless quality" },
] as const;

export type GoalId = (typeof GOALS)[number]["id"];

export function PressHome({
  selectedGoal,
  onGoalChange,
  onRoute,
  onTrySample,
}: {
  selectedGoal: GoalId | null;
  onGoalChange: (goal: GoalId | null) => void;
  onRoute: (route: PressRoute) => void;
  onTrySample: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-8 pb-6 pt-4 text-center">
      {/* Brand lockup */}
      <div className="flex flex-col items-center gap-3">
        <img
          src="/icon.svg"
          alt="The Press — pixel-press mark"
          className="size-14 rounded-2xl shadow-[0_0_40px_oklch(0.72_0.19_300/0.35)]"
        />
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-primary">
            The Press
          </p>
          <h1 className="mt-1 text-4xl font-semibold tracking-tight sm:text-5xl">
            pixel-press
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Compress like you mean it.
          </p>
        </div>
      </div>

      {/* Goal chips — plain words, picked before (or after) the drop */}
      <div
        className="flex flex-wrap items-center justify-center gap-2"
        role="radiogroup"
        aria-label="What should the press do?"
      >
        {GOALS.map((goal) => {
          const active = selectedGoal === goal.id;
          return (
            <button
              key={goal.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onGoalChange(active ? null : goal.id)}
              className={cn(
                "rounded-full border px-4 py-2 text-xs font-medium transition-all",
                active
                  ? "border-primary/70 bg-primary text-primary-foreground shadow-[0_0_18px_oklch(0.72_0.19_300/0.4)]"
                  : "border-border bg-card/60 text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              {goal.label}
            </button>
          );
        })}
      </div>

      <PressDropZone onRoute={onRoute} />

      <button
        type="button"
        onClick={onTrySample}
        className="inline-flex items-center gap-1.5 text-xs text-info underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
      >
        <Sparkles className="size-3.5" aria-hidden />
        No video handy? Try a sample clip
        <ArrowRight className="size-3" aria-hidden />
      </button>

      <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="size-3.5 text-success" aria-hidden />
        Local-first · nothing uploads · no accounts · no telemetry
      </p>
    </div>
  );
}

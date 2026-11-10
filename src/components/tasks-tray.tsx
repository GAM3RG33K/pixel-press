// src/components/tasks-tray.tsx
import { useState } from "react";
import { useSyncExternalStore } from "react";
import {
  Loader2,
  ChevronUp,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Zap,
  BarChart3,
  FolderOpen,
  ShieldCheck,
  Wrench,
  Sparkles,
} from "lucide-react";
import {
  getTasks,
  subscribe,
  cancelTask,
  type Task,
  type TaskWorkbench,
} from "@/lib/tasks/registry";
import { cn } from "@/lib/utils";

const WORKBENCH_ICON: Record<TaskWorkbench, typeof Zap> = {
  compress: Zap,
  compare: BarChart3,
  optimize: FolderOpen,
  audit: ShieldCheck,
  setup: Wrench,
  ai: Sparkles,
};

const WORKBENCH_TAB: Record<TaskWorkbench, "compress" | "compare" | "optimize" | "audit" | null> = {
  compress: "compress",
  compare: "compare",
  optimize: "optimize",
  audit: "audit",
  setup: null,
  ai: null,
};

function elapsed(startedAt: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function Row({
  task,
  onJump,
}: {
  task: Task;
  onJump: (task: Task) => void;
}) {
  const Icon = WORKBENCH_ICON[task.workbench];
  const jumpable = WORKBENCH_TAB[task.workbench] !== null;
  const failed = task.status === "failed";
  const cancelled = task.status === "cancelled";
  const done = task.status === "completed";

  return (
    <li
      className={cn(
        "group flex items-center gap-3 border-b border-border/60 px-3 py-2.5 last:border-b-0",
        failed || cancelled ? "bg-destructive/5" : null,
      )}
    >
      <Icon
        className={cn(
          "size-4 shrink-0",
          done ? "text-success" : failed ? "text-destructive" : "text-primary",
        )}
        aria-hidden
      />
      <button
        type="button"
        onClick={() => jumpable && onJump(task)}
        disabled={!jumpable}
        className="min-w-0 flex-1 text-left disabled:cursor-default"
        aria-label={jumpable ? `Go to ${task.workbench} workbench` : undefined}
      >
        <span className="block truncate text-xs font-medium text-foreground">{task.label}</span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
          {done
            ? "Done"
            : cancelled
              ? "Cancelled"
              : failed
                ? task.error ?? "Failed"
                : task.stage ?? "Working…"}
          {task.progress != null && !done && !failed ? ` · ${Math.round(task.progress)}%` : null}
          {task.status === "running" ? ` · ${elapsed(task.startedAt)}` : null}
        </span>
      </button>
      {task.cancel ? (
        <button
          type="button"
          onClick={() => cancelTask(task.id)}
          className="rounded-md border border-destructive/40 bg-destructive/10 p-1.5 text-destructive transition-colors hover:bg-destructive/20"
          aria-label="Cancel task"
          title="Cancel"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      ) : done ? (
        <CheckCircle2 className="size-4 text-success" aria-hidden />
      ) : failed || cancelled ? (
        <AlertCircle className="size-4 text-destructive" aria-hidden />
      ) : (
        <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
      )}
    </li>
  );
}

export function TasksTray({ onNavigate }: { onNavigate: (tab: "compress" | "compare" | "optimize" | "audit") => void }) {
  const tasks = useSyncExternalStore(subscribe, getTasks, getTasks);
  const [expanded, setExpanded] = useState(false);

  const active = tasks.filter((t) => t.status === "running");
  const visible = tasks.slice(0, 4);
  const hidden = tasks.length - visible.length;

  if (tasks.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Tasks in progress"
      className="fixed bottom-4 left-1/2 z-40 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2"
    >
      {expanded ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card/95 shadow-lg backdrop-blur">
          <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {active.length} {active.length === 1 ? "task" : "tasks"} running
            </span>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground"
              aria-label="Collapse"
            >
              <ChevronUp className="size-4" aria-hidden />
            </button>
          </div>
          <ul className="max-h-64 overflow-y-auto">
            {visible.map((task) => (
              <Row
                key={task.id}
                task={task}
                onJump={(t) => {
                  const tab = WORKBENCH_TAB[t.workbench];
                  if (tab) onNavigate(tab);
                }}
              />
            ))}
            {hidden > 0 ? (
              <li className="px-3 py-2 text-center text-[11px] text-muted-foreground">
                +{hidden} more
              </li>
            ) : null}
          </ul>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-center gap-2 rounded-full border border-border bg-card/90 px-4 py-2.5 shadow-lg backdrop-blur transition-colors hover:border-primary/50"
          aria-expanded={false}
        >
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
          <span className="text-xs font-medium">
            {active.length} {active.length === 1 ? "task" : "tasks"} running
          </span>
          <ChevronUp className="size-4 text-muted-foreground" aria-hidden />
        </button>
      )}
    </div>
  );
}

export type TaskWorkbench = "compress" | "compare" | "optimize" | "audit" | "setup" | "ai";
export type TaskStatus = "running" | "completed" | "failed" | "cancelled";

export interface Task {
  id: string;
  workbench: TaskWorkbench;
  label: string;
  stage: string | null;
  /** 0–100, or null for indeterminate. */
  progress: number | null;
  status: TaskStatus;
  startedAt: number;
  cancel: (() => void) | null;
  error: string | null;
}

type Listener = (tasks: Task[]) => void;

const tasks = new Map<string, Task>();
const listeners = new Set<Listener>();
const removalTimers = new Map<string, ReturnType<typeof setTimeout>>();
let cachedSnapshot: Task[] = [];

const LINGER_MS = 10_000;

function emit(): void {
  cachedSnapshot = [...tasks.values()].sort((a, b) => a.startedAt - b.startedAt);
  for (const fn of listeners) {
    try {
      fn(cachedSnapshot);
    } catch {
      // A broken subscriber must not corrupt the store or block peers.
    }
  }
}

function scheduleRemoval(id: string): void {
  const existing = removalTimers.get(id);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    tasks.delete(id);
    removalTimers.delete(id);
    emit();
  }, LINGER_MS);
  removalTimers.set(id, timer);
}

export function registerTask(init: Omit<Task, "id" | "status" | "startedAt" | "error">): string {
  const id = crypto.randomUUID();
  tasks.set(id, {
    id,
    status: "running",
    startedAt: Date.now(),
    error: null,
    label: init.label,
    stage: init.stage ?? null,
    progress: init.progress ?? null,
    workbench: init.workbench,
    cancel: init.cancel ?? null,
  });
  emit();
  return id;
}

export function updateTask(id: string, patch: Partial<Pick<Task, "stage" | "progress" | "cancel" | "label">>): void {
  const task = tasks.get(id);
  if (!task) return;
  tasks.set(id, { ...task, ...patch });
  emit();
}

export function completeTask(id: string): void {
  finishTask(id, "completed", null);
}

export function failTask(id: string, error: string): void {
  finishTask(id, "failed", error);
}

export function cancelTask(id: string): void {
  const task = tasks.get(id);
  if (task?.status === "running" && task.cancel) task.cancel();
  finishTask(id, "cancelled", null);
}

function finishTask(id: string, status: TaskStatus, error: string | null): void {
  const task = tasks.get(id);
  if (!task || task.status !== "running") return;
  tasks.set(id, { ...task, status, error });
  scheduleRemoval(id);
  emit();
}

export function getTasks(): Task[] {
  return cachedSnapshot;
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Test-only: drop all tasks, listeners and timers. */
export function __clearForTests(): void {
  for (const timer of removalTimers.values()) clearTimeout(timer);
  removalTimers.clear();
  tasks.clear();
  listeners.clear();
  cachedSnapshot = [];
}

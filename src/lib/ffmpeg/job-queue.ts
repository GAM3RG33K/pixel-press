export type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface JobHandle<T> {
  id: string;
  promise: Promise<T>;
  cancel(): void;
  status(): JobStatus;
}

export interface JobQueueOptions {
  concurrency?: number;
}

interface JobRecord {
  id: string;
  task: (signal: AbortSignal) => Promise<unknown>;
  controller: AbortController;
  externalSignal?: AbortSignal;
  removeExternalListener?: () => void;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  status: JobStatus;
}

let jobCounter = 0;

function nextJobId(): string {
  jobCounter += 1;
  return `job-${jobCounter}`;
}

function abortError(): DOMException {
  return new DOMException("Job cancelled", "AbortError");
}

export class JobQueue {
  private readonly concurrency: number;
  private readonly pending: JobRecord[] = [];
  private readonly running = new Set<JobRecord>();
  private readonly idleResolvers: Array<() => void> = [];

  constructor(options: JobQueueOptions = {}) {
    this.concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));
  }

  get size(): number {
    return this.pending.length + this.running.size;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get activeCount(): number {
    return this.running.size;
  }

  add<T>(
    task: (signal: AbortSignal) => Promise<T>,
    options: { signal?: AbortSignal } = {},
  ): JobHandle<T> {
    const id = nextJobId();
    const controller = new AbortController();

    let resolvePromise!: (value: unknown) => void;
    let rejectPromise!: (reason: unknown) => void;
    const promise = new Promise<unknown>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    const record: JobRecord = {
      id,
      task,
      controller,
      resolve: resolvePromise,
      reject: rejectPromise,
      status: "pending",
    };

    const externalSignal = options.signal;
    if (externalSignal) {
      record.externalSignal = externalSignal;
      if (externalSignal.aborted) {
        record.status = "cancelled";
        this.deferReject(record, abortError());
      } else {
        const onAbort = () => this.cancelRecord(record);
        externalSignal.addEventListener("abort", onAbort, { once: true });
        record.removeExternalListener = () =>
          externalSignal.removeEventListener("abort", onAbort);
      }
    }

    if (record.status === "pending") {
      this.pending.push(record);
      this.pump();
    }

    return {
      id,
      promise: promise as Promise<T>,
      cancel: () => this.cancelRecord(record),
      status: () => record.status,
    };
  }

  clear(): void {
    const jobs = [...this.pending];
    this.pending.length = 0;
    for (const job of jobs) {
      job.status = "cancelled";
      this.deferReject(job, abortError());
    }
    this.maybeResolveIdle();
  }

  cancelAll(): void {
    this.clear();
    for (const job of [...this.running]) {
      this.cancelRecord(job);
    }
  }

  onIdle(): Promise<void> {
    if (this.size === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  private cancelRecord(record: JobRecord): void {
    if (record.status === "cancelled" || record.status === "failed") return;
    if (record.status === "completed") return;

    if (record.status === "pending") {
      const index = this.pending.indexOf(record);
      if (index >= 0) this.pending.splice(index, 1);
      record.status = "cancelled";
      record.removeExternalListener?.();
      this.deferReject(record, abortError());
      this.maybeResolveIdle();
      return;
    }

    // Running: mark cancelled, abort the task, and settle immediately. The
    // task's eventual settlement is ignored by `finish`.
    record.status = "cancelled";
    record.controller.abort();
    record.removeExternalListener?.();
    this.deferReject(record, abortError());
    this.running.delete(record);
    this.pump();
    this.maybeResolveIdle();
  }

  private pump(): void {
    while (this.running.size < this.concurrency && this.pending.length > 0) {
      const record = this.pending.shift();
      if (record) this.start(record);
    }
  }

  private start(record: JobRecord): void {
    record.status = "running";
    this.running.add(record);

    let result: Promise<unknown>;
    try {
      result = Promise.resolve(record.task(record.controller.signal));
    } catch (error) {
      result = Promise.reject(error);
    }

    result.then(
      (value) => {
        if (record.status !== "running") return;
        record.status = "completed";
        record.resolve(value);
        this.finish(record);
      },
      (error: unknown) => {
        if (record.status !== "running") return;
        record.status =
          error instanceof DOMException && error.name === "AbortError"
            ? "cancelled"
            : "failed";
        record.reject(error);
        this.finish(record);
      },
    );
  }

  private finish(record: JobRecord): void {
    record.removeExternalListener?.();
    this.running.delete(record);
    this.pump();
    this.maybeResolveIdle();
  }

  private deferReject(record: JobRecord, error: unknown): void {
    // Defer so callers can attach a rejection handler in the same turn.
    queueMicrotask(() => record.reject(error));
  }

  private maybeResolveIdle(): void {
    if (this.size !== 0 || this.idleResolvers.length === 0) return;
    const resolvers = this.idleResolvers.splice(0);
    for (const resolve of resolvers) resolve();
  }
}

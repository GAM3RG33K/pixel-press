import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  registerTask,
  updateTask,
  completeTask,
  failTask,
  cancelTask,
  getTasks,
  subscribe,
  __clearForTests,
  type Task,
} from "./registry";

const base = {
  workbench: "compress" as const,
  label: "Compress · H.264 23",
  stage: "starting",
  progress: 0,
  cancel: null,
};

describe("task registry", () => {
  beforeEach(() => __clearForTests());
  afterEach(() => vi.useRealTimers());

  it("registers a task and returns a unique id", () => {
    const id = registerTask(base);
    const task = getTasks().find((t) => t.id === id);
    expect(task?.workbench).toBe("compress");
    expect(task?.status).toBe("running");
    expect(task?.progress).toBe(0);
    expect(task?.startedAt).toBeGreaterThan(0);
  });

  it("orders tasks by startedAt (registration order)", () => {
    const a = registerTask(base);
    const b = registerTask({ ...base, label: "Compress · VP9 30" });
    const ids = getTasks().map((t) => t.id);
    expect(ids).toEqual([a, b]);
  });

  it("updates stage and progress", () => {
    const id = registerTask(base);
    updateTask(id, { stage: "CRF 30 · 41%", progress: 41 });
    const task = getTasks().find((t) => t.id === id);
    expect(task?.stage).toBe("CRF 30 · 41%");
    expect(task?.progress).toBe(41);
  });

  it("ignores updates for unknown ids", () => {
    updateTask("nope", { progress: 50 });
    expect(getTasks()).toEqual([]);
  });

  it("subscribes and unsubscribes listeners", () => {
    const calls: Task[][] = [];
    const off = subscribe((tasks) => calls.push(tasks));
    registerTask(base);
    off();
    registerTask(base);
    expect(calls.length).toBe(2); // immediate subscribe call + first register; second register not notified
    expect(calls[1]).toHaveLength(1);
  });

  it("emits a stable snapshot per change (new array each emit)", () => {
    const snaps: Task[][] = [];
    subscribe((t) => snaps.push(t));
    registerTask(base);
    registerTask(base);
    expect(snaps[0]).not.toBe(snaps[1]);
  });

  it("marks a task completed and auto-removes it after 10s", () => {
    vi.useFakeTimers();
    const id = registerTask(base);
    completeTask(id);
    expect(getTasks().find((t) => t.id === id)?.status).toBe("completed");
    vi.advanceTimersByTime(10_000);
    expect(getTasks().find((t) => t.id === id)).toBeUndefined();
  });

  it("marks a task failed with its error and auto-removes it after 10s", () => {
    vi.useFakeTimers();
    const id = registerTask(base);
    failTask(id, "ffmpeg exited with code 1");
    expect(getTasks().find((t) => t.id === id)?.status).toBe("failed");
    expect(getTasks().find((t) => t.id === id)?.error).toBe("ffmpeg exited with code 1");
    vi.advanceTimersByTime(10_000);
    expect(getTasks().find((t) => t.id === id)).toBeUndefined();
  });

  it("cancelTask invokes the cancel callback and marks cancelled", () => {
    const cancel = vi.fn();
    const id = registerTask({ ...base, cancel });
    cancelTask(id);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(getTasks().find((t) => t.id === id)?.status).toBe("cancelled");
  });
});

import { beforeEach, describe, expect, it } from "vitest";

import { JobQueue } from "./job-queue";

const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("JobQueue", () => {
  let queue: JobQueue;

  beforeEach(() => {
    queue = new JobQueue();
  });

  it("runs a single task and resolves", async () => {
    const handle = queue.add(async () => "hello");
    await expect(handle.promise).resolves.toBe("hello");
    expect(handle.status()).toBe("completed");
  });

  it("defaults to serial execution", async () => {
    let active = 0;
    let maxActive = 0;

    const makeTask = (id: number) => async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await tick(5);
      active -= 1;
      return id;
    };

    const handles = [0, 1, 2].map((id) => queue.add(makeTask(id)));
    await Promise.all(handles.map((h) => h.promise));

    expect(maxActive).toBe(1);
  });

  it("honours a higher concurrency limit", async () => {
    const concurrent = new JobQueue({ concurrency: 2 });
    let active = 0;
    let maxActive = 0;

    const handles = [0, 1, 2, 3].map((id) =>
      concurrent.add(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await tick(5);
        active -= 1;
        return id;
      }),
    );

    await Promise.all(handles.map((h) => h.promise));
    expect(maxActive).toBe(2);
  });

  it("rejects a job whose external signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let ran = false;

    const handle = queue.add(
      async () => {
        ran = true;
        return "nope";
      },
      { signal: controller.signal },
    );

    await expect(handle.promise).rejects.toMatchObject({ name: "AbortError" });
    expect(ran).toBe(false);
    expect(handle.status()).toBe("cancelled");
  });

  it("cancels a pending job before it starts", async () => {
    const running = queue.add(() => tick(20).then(() => "first"));
    const pending = queue.add(async () => "second");

    pending.cancel();

    await expect(pending.promise).rejects.toMatchObject({ name: "AbortError" });
    expect(pending.status()).toBe("cancelled");
    await expect(running.promise).resolves.toBe("first");
  });

  it("rejects a running job when cancelled and aborts its signal", async () => {
    let signalAborted = false;

    const handle = queue.add(
      (signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            signalAborted = true;
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );

    handle.cancel();

    await expect(handle.promise).rejects.toMatchObject({ name: "AbortError" });
    expect(signalAborted).toBe(true);
    expect(handle.status()).toBe("cancelled");
  });

  it("clear() rejects only pending jobs", async () => {
    const running = queue.add(() => tick(20).then(() => "running"));
    const pendingA = queue.add(async () => "a");
    const pendingB = queue.add(async () => "b");

    queue.clear();

    await expect(pendingA.promise).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(pendingB.promise).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(running.status()).toBe("running");
    await expect(running.promise).resolves.toBe("running");
  });

  it("a failing task does not block later tasks", async () => {
    const failing = queue.add(async () => {
      throw new Error("task failed");
    });
    const next = queue.add(async () => 42);

    await expect(failing.promise).rejects.toThrow("task failed");
    expect(failing.status()).toBe("failed");
    await expect(next.promise).resolves.toBe(42);
  });

  it("onIdle resolves after all work finishes", async () => {
    const h1 = queue.add(() => tick(5).then(() => 1));
    const h2 = queue.add(() => tick(5).then(() => 2));
    await Promise.all([h1.promise, h2.promise]);
    await expect(queue.onIdle()).resolves.toBeUndefined();
  });

  it("onIdle resolves immediately when empty", async () => {
    await expect(queue.onIdle()).resolves.toBeUndefined();
  });

  it("cancelAll cancels pending and running jobs", async () => {
    const running = queue.add(
      (signal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const pending = queue.add(async () => "pending");

    queue.cancelAll();

    expect(running.status()).toBe("cancelled");
    expect(pending.status()).toBe("cancelled");
    await expect(running.promise).rejects.toMatchObject({ name: "AbortError" });
    await expect(pending.promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("tracks size, pending, and active counts", () => {
    expect(queue.size).toBe(0);

    queue.add(() => tick(10));
    queue.add(() => tick(10));

    expect(queue.size).toBe(2);
    expect(queue.activeCount).toBe(1);
    expect(queue.pendingCount).toBe(1);
  });
});

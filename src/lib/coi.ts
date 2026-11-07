export type IsolationState = "isolated" | "not-isolated" | "unsupported";

export function getIsolationState(): IsolationState {
  if (typeof window === "undefined") return "unsupported";
  if (typeof window.crossOriginIsolated !== "boolean") return "unsupported";
  return window.crossOriginIsolated ? "isolated" : "not-isolated";
}

export function supportsSharedArrayBuffer(): boolean {
  return typeof SharedArrayBuffer !== "undefined";
}

export function supportsWebGpu(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export function logIsolationState(): void {
  console.info(
    "[coi] isolation:",
    getIsolationState(),
    "sharedArrayBuffer:",
    supportsSharedArrayBuffer(),
    "webgpu:",
    supportsWebGpu(),
  );
}
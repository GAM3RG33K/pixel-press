import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import App from "./App";
import { logIsolationState } from "@/lib/coi";
import { cleanupOpfsOlderThan, OPFS_MAX_AGE_MS } from "@/lib/opfs";
import "@fontsource-variable/schibsted-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "./index.css";

// Keep the app installable and offline-capable.
registerSW({ immediate: true });

// Startup garbage collection: drop staging files older than 24 hours.
void cleanupOpfsOlderThan(OPFS_MAX_AGE_MS).catch((error: unknown) => {
  console.warn("[opfs] startup cleanup failed", error);
});

logIsolationState();

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

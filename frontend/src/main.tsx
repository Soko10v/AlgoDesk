import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./index.css";

// After a deploy, an already-open tab still references the old content-hashed
// chunks, which no longer exist on the server (404) — lazy-navigating then throws
// "Failed to fetch dynamically imported module". Vite fires `vite:preloadError`
// on such failures; reload once to pull the fresh index.html and new chunk names.
// The timestamp guard avoids a reload loop when the chunk is genuinely
// unreachable (offline or a real 404).
window.addEventListener("vite:preloadError", () => {
  const now = Date.now();
  const last = Number(sessionStorage.getItem("vite_preload_reload_at") ?? 0);
  if (now - last < 10_000) return;
  sessionStorage.setItem("vite_preload_reload_at", String(now));
  window.location.reload();
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, staleTime: 10_000, retry: 1 },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);

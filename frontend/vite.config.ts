import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "0.0.0.0",
  },
  build: {
    // Split the stable React core into its own chunk so it stays cached across
    // app deploys. reactflow and lightweight-charts are pulled in only by their
    // lazily-imported pages, so Rollup already keeps them out of the entry.
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "data-vendor": ["@tanstack/react-query", "@supabase/supabase-js", "axios"],
        },
      },
    },
  },
});

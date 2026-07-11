import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Both .ts (logic/lib) and .tsx (components) — a .tsx-only glob silently
    // skipped lib tests like `lib/api.test.ts`, which is why the auth
    // response-shape bug shipped untested.
    include: ["src/**/*.test.{ts,tsx}"],
  },
});

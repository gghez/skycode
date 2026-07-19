import "dotenv/config";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Separate from vitest.config.ts (and its own "npm test" / "npm run test:integration"
// script) on purpose: tests here hit a real Postgres via DATABASE_URL, while
// `npm test` must stay DB-free. See tests/integration/authorization.test.ts.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // "server-only" resolves its `react-server` export condition (-> a no-op) only
      // inside Next's own bundler; under plain Vitest/Node it always resolves to the
      // throwing `index.js`. Alias it to the package's own no-op module so importing
      // src/lib/repos/service.ts here behaves like it does inside a real server component.
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
  },
});

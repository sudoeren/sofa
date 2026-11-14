import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    // Process tokens.css for real: the runtime imports it with ?raw to build tool frames.
    // Other stylesheets stay empty in tests.
    css: { include: [/tokens\.css/] },
  },
});

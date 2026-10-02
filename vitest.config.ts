import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    // `server-only` es un paquete-marcador: su entrada por defecto lanza
    // "cannot be imported from a Client Component". Next lo resuelve con la
    // condición `react-server`; en vitest no existe, así que apuntamos al
    // módulo vacío que el propio paquete trae para ese caso. Ruta absoluta
    // porque su campo `exports` no publica el subpath.
    alias: {
      "server-only": path.resolve(
        process.cwd(),
        "node_modules/server-only/empty.js",
      ),
    },
  },
  test: {
    // Reuse a bounded thread pool; spawning a fork per file stalls on Windows
    // and unrestricted workers exceed CI memory for the inherited large suite.
    pool: 'threads',
    maxWorkers: 2,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Dummy secrets — encryption.ts / webhook-signature.ts read these
    // at module load. Tests never hit a real Meta/Supabase service, so
    // any 32-byte hex / non-empty string will do; keep them lexically
    // identical to the CI build env so behaviour matches.
    env: {
      // Keep the inherited ecommerce regression suite running in its original vertical.
      // Dealer tests explicitly enable and verify the independent dealer vertical.
      NEXT_PUBLIC_RIVERZ_VERTICAL: "ecommerce",
      ENCRYPTION_KEY:
        "0000000000000000000000000000000000000000000000000000000000000000",
      META_APP_SECRET: "test-meta-app-secret",
    },
    clearMocks: true,
  },
});

import { defineConfig } from "vitest/config";
import { RUTA_DB_TEST } from "./server/__tests__/ruta-db-test";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./server/__tests__/setup.ts"],
    testTimeout: 20000,
    hookTimeout: 30000,
    env: {
      DATABASE_URL: `file:${RUTA_DB_TEST}`,
    },
    // Todos los tests comparten la misma base SQLite de archivo — correrlos
    // en paralelo arriesga bloqueos (SQLITE_BUSY) sin ganar nada real, ya
    // que de todas formas hay que serializar el acceso a un solo archivo.
    fileParallelism: false,
  },
});

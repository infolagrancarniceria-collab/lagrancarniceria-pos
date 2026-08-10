import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  server: {
    port: 5174,
    host: true, // escucha en la red local (LAN), no solo localhost
    proxy: {
      "/api": "http://localhost:5175",
    },
  },
  build: {
    outDir: "../web-dist",
    emptyOutDir: true,
  },
});

import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backendProxy = {
  target: "http://localhost:8000",
  changeOrigin: true,
};

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      "/search": backendProxy,
      "/catalog": backendProxy,
      "/media": backendProxy,
      "/health": backendProxy,
      "/trials": backendProxy,
    },
  },
  preview: {
    host: true,
    port: 4173,
    strictPort: true,
    proxy: {
      "/search": backendProxy,
      "/catalog": backendProxy,
      "/media": backendProxy,
      "/health": backendProxy,
      "/trials": backendProxy,
    },
  },
});

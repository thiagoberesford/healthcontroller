import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // base obrigatório para GitHub Pages (repo: healthcontroller)
  base: "/healthcontroller/",
  server: {
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});

import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: "../../",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api/auth": {
        target: "http://localhost:3211",
        changeOrigin: true,
      },
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
})

import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../../", "BACKEND_")
  return {
    plugins: [react(), tailwindcss()],
    envDir: "../../",
    define: {
      "import.meta.env.VITE_BACKEND_MODE": JSON.stringify(
        env.BACKEND_MODE || "datalab",
      ),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      proxy: {
        "/api": {
          target: "http://localhost:8787",
          changeOrigin: true,
        },
      },
    },
  }
})

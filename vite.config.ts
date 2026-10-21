import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { reviewsProxyPlugin } from "./vite.reviews-proxy"
import { teamworkProxyPlugin } from "./vite.teamwork-proxy"

export default defineConfig({
  plugins: [react(), teamworkProxyPlugin(), reviewsProxyPlugin()],
  server: { port: 5173 },
})

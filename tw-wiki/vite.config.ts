import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { teamworkWikiProxy } from "./vite.proxy"

export default defineConfig({
  envDir: "..",
  plugins: [react(), teamworkWikiProxy()],
  server: { port: 5174 },
})

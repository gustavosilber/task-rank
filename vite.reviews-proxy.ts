import type { IncomingMessage, ServerResponse } from "node:http"
import { loadEnv, type Plugin } from "vite"
import { handleReviewsRequest } from "./api/_lib/reviews"

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

function applyEnv(mode: string, envDir: string) {
  const env = loadEnv(mode, envDir, "")
  if (env.DATABASE_URL && !process.env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL
  if (env.POSTGRES_URL && !process.env.POSTGRES_URL) process.env.POSTGRES_URL = env.POSTGRES_URL
  if (env.GOOGLE_CLIENT_ID && !process.env.GOOGLE_CLIENT_ID) process.env.GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID
  if (env.VITE_GOOGLE_CLIENT_ID && !process.env.VITE_GOOGLE_CLIENT_ID) {
    process.env.VITE_GOOGLE_CLIENT_ID = env.VITE_GOOGLE_CLIENT_ID
  }
}

export function reviewsProxyPlugin(): Plugin {
  return {
    name: "reviews-proxy",
    configResolved(config) {
      applyEnv(config.mode, config.envDir)
    },
    configureServer(server) {
      applyEnv(server.config.mode, server.config.envDir)
      server.middlewares.use(async (req, res: ServerResponse, next) => {
        const url = req.url ?? ""
        if (!url.startsWith("/api/reviews")) return next()
        const result = await handleReviewsRequest({
          method: req.method ?? "GET",
          authorization: typeof req.headers.authorization === "string" ? req.headers.authorization : "",
          body: (req.method ?? "GET") === "GET" || (req.method ?? "") === "HEAD" ? "" : await readBody(req),
        })
        res.statusCode = result.status
        res.setHeader("Content-Type", "application/json")
        res.end(JSON.stringify(result.body))
      })
    },
  }
}

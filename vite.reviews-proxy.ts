import type { IncomingMessage, ServerResponse } from "node:http"
import { loadEnv, type Plugin } from "vite"
import { handleReviewsRequest } from "./api/reviews"
import { handleSyncRequest } from "./api/sync"
import { handleWorkspaceRequest } from "./api/workspace"

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
  const keys = [
    "DATABASE_URL",
    "POSTGRES_URL",
    "GOOGLE_CLIENT_ID",
    "VITE_GOOGLE_CLIENT_ID",
    "TEAMWORK_SITE_URL",
    "VITE_TEAMWORK_SITE_URL",
    "TEAMWORK_API_KEY",
    "VITE_TEAMWORK_API_KEY",
    "CRON_SECRET",
  ]
  for (const key of keys) {
    if (env[key] && !process.env[key]) process.env[key] = env[key]
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
        const url = (req.url ?? "").split("?")[0]
        const authorization = typeof req.headers.authorization === "string" ? req.headers.authorization : ""
        const method = req.method ?? "GET"
        const body = method === "GET" || method === "HEAD" ? "" : await readBody(req)
        let result: { status: number; body: unknown } | null = null
        if (url === "/api/reviews") {
          result = await handleReviewsRequest({ method, authorization, body })
        } else if (url === "/api/workspace") {
          result = await handleWorkspaceRequest({ method, authorization })
        } else if (url === "/api/sync") {
          result = await handleSyncRequest({ method, authorization, cron: false, body })
        }
        if (!result) return next()
        res.statusCode = result.status
        res.setHeader("Content-Type", "application/json")
        res.end(JSON.stringify(result.body))
      })
    },
  }
}

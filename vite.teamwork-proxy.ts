import type { IncomingMessage, ServerResponse } from "node:http"
import type { Plugin } from "vite"
import { proxyTeamwork } from "./api/teamwork"

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on("end", () => resolve(Buffer.concat(chunks)))
    req.on("error", reject)
  })
}

function headerValue(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : ""
}

export function teamworkProxyPlugin(): Plugin {
  return {
    name: "teamwork-proxy",
    configureServer(server) {
      server.middlewares.use(async (req, res: ServerResponse, next) => {
        if (!req.url?.startsWith("/api/teamwork")) return next()
        const incoming = new URL(req.url, "http://localhost")
        const method = req.method ?? "GET"
        const twPath = incoming.searchParams.get("tw_path") || incoming.pathname
        incoming.searchParams.delete("tw_path")
        const result = await proxyTeamwork({
          method,
          pathname: twPath,
          search: incoming.search,
          site: headerValue(req.headers["x-teamwork-site"]),
          token: headerValue(req.headers["x-teamwork-token"]),
          user: headerValue(req.headers["x-teamwork-user"]),
          password: headerValue(req.headers["x-teamwork-password"]),
          contentType: headerValue(req.headers["content-type"]),
          body: method === "GET" || method === "HEAD" ? undefined : await readBody(req),
        })
        res.statusCode = result.status
        res.setHeader("Content-Type", result.contentType)
        res.end(result.body)
      })
    },
  }
}

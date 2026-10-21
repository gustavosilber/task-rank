import type { IncomingMessage, ServerResponse } from "node:http"
import type { Plugin } from "vite"

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on("end", () => resolve(Buffer.concat(chunks)))
    req.on("error", reject)
  })
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader("Content-Type", "application/json")
  res.end(JSON.stringify(payload))
}

function headerValue(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : ""
}

export function teamworkProxyPlugin(): Plugin {
  return {
    name: "teamwork-proxy",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/teamwork")) return next()

        const site = headerValue(req.headers["x-teamwork-site"])
        const token = headerValue(req.headers["x-teamwork-token"])
        const user = headerValue(req.headers["x-teamwork-user"])
        const password = headerValue(req.headers["x-teamwork-password"])

        if (!site) return sendJson(res, 401, { error: "Missing X-Teamwork-Site." })
        if (!token && !(user && password)) {
          return sendJson(res, 401, { error: "Missing Teamwork API key or email/password." })
        }

        let base: URL
        try {
          base = new URL(site)
        } catch {
          return sendJson(res, 400, { error: "X-Teamwork-Site is not a valid URL." })
        }

        const incoming = new URL(req.url, "http://localhost")
        const targetPath = incoming.pathname.replace(/^\/api\/teamwork/, "") || "/"
        const target = new URL(targetPath + incoming.search, base)
        const method = req.method ?? "GET"
        const basicUser = token || user
        const basicPass = token ? "xxx" : password
        const headers: Record<string, string> = {
          Accept: "application/json",
          Authorization: `Basic ${Buffer.from(`${basicUser}:${basicPass}`).toString("base64")}`,
        }

        let body: Buffer | undefined
        if (method !== "GET" && method !== "HEAD") {
          body = await readBody(req)
          if (body.length > 0) headers["Content-Type"] = String(req.headers["content-type"] ?? "application/json")
        }

        try {
          const upstream = await fetch(target, { method, headers, body })
          const buffer = Buffer.from(await upstream.arrayBuffer())
          res.statusCode = upstream.status
          const contentType = upstream.headers.get("content-type")
          if (contentType) res.setHeader("Content-Type", contentType)
          res.end(buffer)
        } catch (error) {
          sendJson(res, 502, {
            error: error instanceof Error ? error.message : "Could not reach Teamwork.",
          })
        }
      })
    },
  }
}

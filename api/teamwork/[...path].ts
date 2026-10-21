import type { VercelRequest, VercelResponse } from "@vercel/node"
import { proxyTeamwork } from "../_lib/teamwork-proxy"

function headerValue(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : ""
}

function incomingPath(req: VercelRequest): { pathname: string; search: string } {
  const url = new URL(req.url || "/api/teamwork", "https://task-rank.vercel.app")
  const path = req.query.path
  const extra = Array.isArray(path) ? path.join("/") : typeof path === "string" ? path : ""
  return {
    pathname: extra ? `/api/teamwork/${extra}` : url.pathname,
    search: url.search,
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { pathname, search } = incomingPath(req)
  const rawBody =
    req.method === "GET" || req.method === "HEAD"
      ? undefined
      : typeof req.body === "string" || Buffer.isBuffer(req.body)
        ? req.body
        : req.body == null
          ? undefined
          : JSON.stringify(req.body)

  const result = await proxyTeamwork({
    method: req.method ?? "GET",
    pathname,
    search,
    site: headerValue(req.headers["x-teamwork-site"]),
    token: headerValue(req.headers["x-teamwork-token"]),
    user: headerValue(req.headers["x-teamwork-user"]),
    password: headerValue(req.headers["x-teamwork-password"]),
    contentType: headerValue(req.headers["content-type"]),
    body: rawBody,
  })

  res.status(result.status)
  res.setHeader("Content-Type", result.contentType)
  res.send(result.body)
}

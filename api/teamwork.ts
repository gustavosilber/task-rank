import type { VercelRequest, VercelResponse } from "@vercel/node"

export type TeamworkProxyRequest = {
  method: string
  pathname: string
  search: string
  site: string
  token: string
  user: string
  password: string
  contentType?: string
  body?: Buffer | string
}

export type TeamworkProxyResponse = {
  status: number
  contentType: string
  body: Buffer
}

function jsonBuffer(status: number, payload: unknown): TeamworkProxyResponse {
  return {
    status,
    contentType: "application/json",
    body: Buffer.from(JSON.stringify(payload)),
  }
}

function headerValue(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : ""
}

export async function proxyTeamwork(request: TeamworkProxyRequest): Promise<TeamworkProxyResponse> {
  if (!request.site) return jsonBuffer(401, { error: "Missing X-Teamwork-Site." })
  if (!request.token && !(request.user && request.password)) {
    return jsonBuffer(401, { error: "Missing Teamwork API key or email/password." })
  }

  let base: URL
  try {
    base = new URL(request.site)
  } catch {
    return jsonBuffer(400, { error: "X-Teamwork-Site is not a valid URL." })
  }

  const targetPath = request.pathname.replace(/^\/api\/teamwork/, "") || "/"
  const target = new URL(targetPath + request.search, base)
  const method = request.method || "GET"
  const basicUser = request.token || request.user
  const basicPass = request.token ? "xxx" : request.password
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Basic ${Buffer.from(`${basicUser}:${basicPass}`).toString("base64")}`,
  }

  let body: Buffer | string | undefined
  if (method !== "GET" && method !== "HEAD" && request.body) {
    body = request.body
    if ((typeof body === "string" && body.length > 0) || (Buffer.isBuffer(body) && body.length > 0)) {
      headers["Content-Type"] = request.contentType || "application/json"
    }
  }

  try {
    const upstream = await fetch(target, { method, headers, body })
    const buffer = Buffer.from(await upstream.arrayBuffer())
    return {
      status: upstream.status,
      contentType: upstream.headers.get("content-type") || "application/json",
      body: buffer,
    }
  } catch (error) {
    return jsonBuffer(502, {
      error: error instanceof Error ? error.message : "Could not reach Teamwork.",
    })
  }
}

function resolveTarget(req: VercelRequest): { pathname: string; search: string } {
  const url = new URL(req.url || "/api/teamwork", "https://task-rank.vercel.app")
  const twPath = headerValue(typeof req.query.tw_path === "string" ? req.query.tw_path : undefined) || headerValue(url.searchParams.get("tw_path") || "")
  url.searchParams.delete("tw_path")
  if (twPath) {
    return { pathname: twPath.startsWith("/") ? twPath : `/${twPath}`, search: url.search }
  }
  const forwarded = headerValue(req.headers["x-forwarded-uri"])
  if (forwarded.includes("/api/teamwork/")) {
    const original = new URL(forwarded, "https://task-rank.vercel.app")
    return { pathname: original.pathname, search: original.search }
  }
  return { pathname: url.pathname, search: url.search }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { pathname, search } = resolveTarget(req)
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

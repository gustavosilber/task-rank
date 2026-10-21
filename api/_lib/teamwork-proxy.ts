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

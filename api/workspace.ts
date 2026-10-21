import type { VercelRequest, VercelResponse } from "@vercel/node"
import { handleWorkspaceRequest } from "./sync"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const result = await handleWorkspaceRequest({
    method: req.method ?? "GET",
    authorization: String(req.headers.authorization ?? ""),
    cron: false,
    body: "",
  })
  res.status(result.status).json(result.body)
}

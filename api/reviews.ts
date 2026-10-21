import type { VercelRequest, VercelResponse } from "@vercel/node"
import { handleReviewsRequest } from "../server/reviews"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const body = typeof req.body === "string" ? req.body : req.body == null ? "" : JSON.stringify(req.body)
  const result = await handleReviewsRequest({
    method: req.method ?? "GET",
    authorization: String(req.headers.authorization ?? ""),
    body,
  })
  res.status(result.status).json(result.body)
}

import { neon } from "@neondatabase/serverless"
import type { VercelRequest, VercelResponse } from "@vercel/node"

type Direction = "pm_to_dev" | "dev_to_pm"
type Scores = Partial<Record<string, number>>
type AuthUser = { email: string; name: string; isSuperUser: boolean }
type Review = {
  id: string
  taskId: string
  direction: Direction
  raterId: string
  rateeId: string
  scores: Scores
  detail: string
  createdAt: string
}

export type ReviewsRequest = { method: string; authorization: string; body: string }
export type ReviewsResponse = { status: number; body: unknown }

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function isSuperUserEmail(email: string): boolean {
  return email.trim().toLowerCase() === "dev@bestworlddsweb.com"
}

function databaseUrl(): string {
  return process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim() || ""
}

function sql() {
  const url = databaseUrl()
  if (!url) throw new HttpError(503, "DATABASE_URL is not set. Add a Neon connection string.")
  return neon(url)
}

let schemaReady: Promise<void> | null = null

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const query = sql()
      await query`
        CREATE TABLE IF NOT EXISTS reviews (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          direction TEXT NOT NULL CHECK (direction IN ('pm_to_dev', 'dev_to_pm')),
          rater_id TEXT NOT NULL,
          ratee_id TEXT NOT NULL,
          rater_email TEXT NOT NULL,
          ratee_email TEXT NOT NULL DEFAULT '',
          saved_by_email TEXT NOT NULL,
          scores JSONB NOT NULL,
          detail TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `
      await query`ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_task_id_direction_key`
      await query`ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_task_id_direction_rater_id_ratee_id_key`
      await query`CREATE UNIQUE INDEX IF NOT EXISTS reviews_slot_unique ON reviews (task_id, direction, rater_id, ratee_id)`
      await query`CREATE INDEX IF NOT EXISTS reviews_saved_by_email_idx ON reviews (saved_by_email)`
      await query`CREATE INDEX IF NOT EXISTS reviews_rater_email_idx ON reviews (rater_email)`
      await query`CREATE INDEX IF NOT EXISTS reviews_ratee_email_idx ON reviews (ratee_email)`
      await query`CREATE INDEX IF NOT EXISTS reviews_task_id_idx ON reviews (task_id)`
    })().catch((error) => {
      schemaReady = null
      throw error
    })
  }
  await schemaReady
}

async function verifyGoogleUser(authorization: string): Promise<AuthUser> {
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : ""
  if (!token) throw new HttpError(401, "Sign in with Google to load or save ratings.")
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`)
  const payload = (await response.json()) as {
    aud?: string
    email?: string
    email_verified?: string | boolean
    name?: string
    error?: string
    error_description?: string
  }
  if (!response.ok || payload.error || !payload.email) {
    throw new HttpError(401, "Google session expired. Sign in again.")
  }
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || process.env.VITE_GOOGLE_CLIENT_ID?.trim() || ""
  if (clientId && payload.aud !== clientId) throw new HttpError(401, "Google token does not match this app.")
  if (payload.email_verified === false || payload.email_verified === "false") {
    throw new HttpError(401, "The Google email is not verified.")
  }
  const email = payload.email.trim().toLowerCase()
  return { email, name: payload.name?.trim() || email, isSuperUser: isSuperUserEmail(email) }
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

function isDirection(value: unknown): value is Direction {
  return value === "pm_to_dev" || value === "dev_to_pm"
}

function isScores(value: unknown): value is Scores {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

type ReviewRow = {
  id: string
  task_id: string
  direction: Direction
  rater_id: string
  ratee_id: string
  scores: Scores | string
  detail: string
  created_at: string | Date
}

function toIsoDate(value: string | Date): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  const match = String(value).match(/\d{4}-\d{2}-\d{2}/)
  if (match) return match[0]
  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  return new Date().toISOString().slice(0, 10)
}

type ReviewInput = Review & { raterEmail?: string; rateeEmail?: string }

function toReview(row: ReviewRow): Review {
  const scores = typeof row.scores === "string" ? (JSON.parse(row.scores) as Scores) : row.scores
  return {
    id: row.id,
    taskId: row.task_id,
    direction: row.direction,
    raterId: row.rater_id,
    rateeId: row.ratee_id,
    scores: isScores(scores) ? scores : {},
    detail: row.detail ?? "",
    createdAt: toIsoDate(row.created_at),
  }
}

function parseReview(value: unknown): ReviewInput {
  if (!value || typeof value !== "object") throw new HttpError(400, "Review payload is missing.")
  const review = value as Partial<ReviewInput>
  if (
    typeof review.id !== "string" ||
    typeof review.taskId !== "string" ||
    !isDirection(review.direction) ||
    typeof review.raterId !== "string" ||
    typeof review.rateeId !== "string" ||
    typeof review.detail !== "string" ||
    !isScores(review.scores)
  ) {
    throw new HttpError(400, "Review payload is incomplete.")
  }
  return {
    id: review.id.trim(),
    taskId: review.taskId.trim(),
    direction: review.direction,
    raterId: review.raterId.trim(),
    rateeId: review.rateeId.trim(),
    scores: review.scores,
    detail: review.detail.trim(),
    createdAt: typeof review.createdAt === "string" && review.createdAt ? review.createdAt : new Date().toISOString().slice(0, 10),
    raterEmail: normalizeEmail(review.raterEmail),
    rateeEmail: normalizeEmail(review.rateeEmail),
  }
}

function parseReviewList(value: unknown): ReviewInput[] {
  if (Array.isArray(value)) return value.map(parseReview)
  if (value && typeof value === "object" && Array.isArray((value as { reviews?: unknown }).reviews)) {
    return (value as { reviews: unknown[] }).reviews.map(parseReview)
  }
  return [parseReview(value)]
}

async function listReviews(user: AuthUser): Promise<Review[]> {
  const query = sql()
  const rows = user.isSuperUser
    ? ((await query`SELECT * FROM reviews ORDER BY created_at DESC`) as ReviewRow[])
    : ((await query`
        SELECT * FROM reviews
        WHERE saved_by_email = ${user.email}
           OR rater_email = ${user.email}
           OR ratee_email = ${user.email}
        ORDER BY created_at DESC
      `) as ReviewRow[])
  return rows.map(toReview)
}

async function upsertReview(user: AuthUser, input: ReviewInput): Promise<Review> {
  if (input.raterId === input.rateeId) throw new HttpError(400, "You cannot rate yourself.")
  if (!user.isSuperUser && input.raterEmail && input.raterEmail !== user.email) {
    throw new HttpError(403, "You can only save reviews as yourself.")
  }
  const raterEmail = user.isSuperUser && input.raterEmail ? input.raterEmail : user.email
  const createdAt = input.createdAt.length <= 10 ? `${input.createdAt}T12:00:00.000Z` : input.createdAt
  const query = sql()
  const rows = (await query`
    INSERT INTO reviews (
      id, task_id, direction, rater_id, ratee_id, rater_email, ratee_email, saved_by_email, scores, detail, created_at, updated_at
    ) VALUES (
      ${input.id},
      ${input.taskId},
      ${input.direction},
      ${input.raterId},
      ${input.rateeId},
      ${raterEmail},
      ${input.rateeEmail ?? ""},
      ${user.email},
      ${JSON.stringify(input.scores)}::jsonb,
      ${input.detail},
      ${createdAt}::timestamptz,
      now()
    )
    ON CONFLICT (task_id, direction, rater_id, ratee_id) DO UPDATE SET
      id = EXCLUDED.id,
      rater_email = EXCLUDED.rater_email,
      ratee_email = EXCLUDED.ratee_email,
      saved_by_email = EXCLUDED.saved_by_email,
      scores = EXCLUDED.scores,
      detail = EXCLUDED.detail,
      updated_at = now()
    RETURNING *
  `) as ReviewRow[]
  const saved = rows[0]
  if (!saved) throw new HttpError(500, "Could not save the review.")
  return toReview(saved)
}

export async function handleReviewsRequest(request: ReviewsRequest): Promise<ReviewsResponse> {
  try {
    if (!databaseUrl()) throw new HttpError(503, "DATABASE_URL is not set. Add a Neon connection string.")
    const method = request.method.toUpperCase()
    if (method !== "GET" && method !== "POST" && method !== "PUT") throw new HttpError(405, "Method not allowed.")
    const user = await verifyGoogleUser(request.authorization)
    await ensureSchema()
    if (method === "GET") return { status: 200, body: { reviews: await listReviews(user) } }
    const payload = request.body.trim() ? JSON.parse(request.body) : null
    const reviews = parseReviewList(payload)
    const saved: Review[] = []
    for (const review of reviews) saved.push(await upsertReview(user, review))
    return { status: 200, body: saved.length === 1 ? { review: saved[0] } : { reviews: saved } }
  } catch (error) {
    const status = error instanceof HttpError ? error.status : typeof (error as { status?: number }).status === "number" ? (error as { status: number }).status : 500
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Could not reach the ratings database."
    return { status, body: { error: message } }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const body = typeof req.body === "string" ? req.body : req.body == null ? "" : JSON.stringify(req.body)
  const result = await handleReviewsRequest({
    method: req.method ?? "GET",
    authorization: String(req.headers.authorization ?? ""),
    body,
  })
  res.status(result.status).json(result.body)
}

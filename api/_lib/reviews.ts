import { HttpError, verifyGoogleUser, type AuthUser } from "./auth"
import { databaseUrl, ensureSchema, sql } from "./db"

type Direction = "pm_to_dev" | "dev_to_pm"
type Scores = Partial<Record<string, number>>

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

export type ReviewsRequest = {
  method: string
  authorization: string
  body: string
}

export type ReviewsResponse = {
  status: number
  body: unknown
}

type ReviewRow = {
  id: string
  task_id: string
  direction: Direction
  rater_id: string
  ratee_id: string
  rater_email: string
  ratee_email: string
  saved_by_email: string
  scores: Scores | string
  detail: string
  created_at: string
}

type ReviewInput = Review & {
  raterEmail?: string
  rateeEmail?: string
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

function asDate(value: string): string {
  return value.slice(0, 10)
}

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
    createdAt: asDate(String(row.created_at)),
  }
}

function parseBody(raw: string): unknown {
  if (!raw.trim()) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new HttpError(400, "Request body is not valid JSON.")
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
  if (!review.taskId.trim() || !review.raterId.trim() || !review.rateeId.trim()) {
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
  if (!user.isSuperUser && input.raterEmail && input.raterEmail !== user.email) {
    throw new HttpError(403, "You can only save reviews as yourself.")
  }

  const raterEmail = user.isSuperUser && input.raterEmail ? input.raterEmail : user.email
  const rateeEmail = input.rateeEmail
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
      ${rateeEmail},
      ${user.email},
      ${JSON.stringify(input.scores)}::jsonb,
      ${input.detail},
      ${createdAt}::timestamptz,
      now()
    )
    ON CONFLICT (task_id, direction) DO UPDATE SET
      id = EXCLUDED.id,
      rater_id = EXCLUDED.rater_id,
      ratee_id = EXCLUDED.ratee_id,
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
    if (!databaseUrl()) {
      throw new HttpError(503, "DATABASE_URL is not set. Add a Neon connection string.")
    }
    const method = request.method.toUpperCase()
    if (method !== "GET" && method !== "POST" && method !== "PUT") {
      throw new HttpError(405, "Method not allowed.")
    }
    const user = await verifyGoogleUser(request.authorization)
    await ensureSchema()
    if (method === "GET") {
      return { status: 200, body: { reviews: await listReviews(user) } }
    }
    const payload = parseBody(request.body)
    const reviews = parseReviewList(payload)
    const saved: Review[] = []
    for (const review of reviews) saved.push(await upsertReview(user, review))
    return { status: 200, body: saved.length === 1 ? { review: saved[0] } : { reviews: saved } }
  } catch (error) {
    const status = error instanceof HttpError ? error.status : typeof (error as { status?: number }).status === "number" ? (error as { status: number }).status : 500
    const message = error instanceof Error ? error.message : "Could not reach the ratings database."
    return { status, body: { error: message } }
  }
}

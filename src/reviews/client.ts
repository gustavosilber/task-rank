import type { Review } from "../types"

export class ReviewsApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export type ReviewPayload = Review & {
  raterEmail?: string
  rateeEmail?: string
}

async function parseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string }
    if (payload.error) return payload.error
  } catch {
    // ignore
  }
  if (response.status === 401) return "Google session expired. Sign in again."
  if (response.status === 503) return "Ratings database is not configured yet."
  return "Could not reach the ratings database."
}

async function reviewsFetch(credential: string, init: RequestInit): Promise<Response> {
  return fetch("/api/reviews", {
    ...init,
    headers: {
      Authorization: `Bearer ${credential}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  })
}

export async function fetchReviews(credential: string): Promise<Review[]> {
  const response = await reviewsFetch(credential, { method: "GET" })
  if (!response.ok) throw new ReviewsApiError(await parseError(response), response.status)
  const payload = (await response.json()) as { reviews?: Review[] }
  return Array.isArray(payload.reviews) ? payload.reviews : []
}

export async function upsertReviews(credential: string, reviews: ReviewPayload[]): Promise<Review[]> {
  if (reviews.length === 0) return []
  const response = await reviewsFetch(credential, {
    method: "POST",
    body: JSON.stringify(reviews.length === 1 ? reviews[0] : { reviews }),
  })
  if (!response.ok) throw new ReviewsApiError(await parseError(response), response.status)
  const payload = (await response.json()) as { review?: Review; reviews?: Review[] }
  if (payload.review) return [payload.review]
  return Array.isArray(payload.reviews) ? payload.reviews : []
}

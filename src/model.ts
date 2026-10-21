import { aspectsFor, directionFor } from "./aspects"
import type { Aspect, AspectId, Lens, Period, Review, Task } from "./types"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function iso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

export function toIsoDate(value: string | Date | null | undefined): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return iso(value)
  if (typeof value !== "string" || !value.trim()) return iso(new Date())
  const match = value.match(/\d{4}-\d{2}-\d{2}/)
  if (match) return match[0]
  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) return iso(parsed)
  return iso(new Date())
}

export function formatDate(isoDate: string): string {
  const [year, month, day] = toIsoDate(isoDate).split("-").map(Number)
  const label = MONTHS[month - 1]
  if (!year || !label || !day) return toIsoDate(isoDate)
  return `${day} ${label} ${year}`
}

export function formatScore(value: number): string {
  return value.toFixed(1)
}

export function tone(value: number): "good" | "mid" | "low" {
  if (value >= 4) return "good"
  if (value >= 3) return "mid"
  return "low"
}

export function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

const DEMO_TODAY = new Date(2026, 9, 14)

export function periodBounds(period: Period, today: Date): { start: string; end: string } {
  const end = iso(today)
  if (period === "30" || period === "90") {
    const start = new Date(today)
    start.setDate(today.getDate() - (period === "30" ? 29 : 89))
    return { start: iso(start), end }
  }
  if (period === "month") return { start: iso(new Date(today.getFullYear(), today.getMonth(), 1)), end }
  return { start: iso(new Date(today.getFullYear(), 0, 1)), end }
}

export function referenceToday(source: "demo" | "teamwork"): Date {
  return source === "demo" ? DEMO_TODAY : new Date()
}

export function availableLenses(tasks: Task[], personId: string): Lens[] {
  const lenses: Lens[] = []
  if (tasks.some((task) => task.devId === personId)) lenses.push("dev")
  if (tasks.some((task) => task.pmId === personId)) lenses.push("pm")
  return lenses
}

export function tasksInPeriod(tasks: Task[], personId: string, lens: Lens, start: string, end: string): Task[] {
  return tasks
    .filter((task) => {
      const ownerId = lens === "dev" ? task.devId : task.pmId
      if (ownerId !== personId) return false
      const anchor = task.completedAt ?? task.startedAt
      return anchor >= start && anchor <= end
    })
    .sort((a, b) => (b.completedAt ?? b.startedAt).localeCompare(a.completedAt ?? a.startedAt))
}

/** Tasks where the person is Dev or PM, anchored to the period by close or start date. */
export function personTasksInPeriod(tasks: Task[], personId: string, start: string, end: string): Task[] {
  return tasks
    .filter((task) => {
      if (task.devId !== personId && task.pmId !== personId) return false
      const anchor = task.completedAt ?? task.startedAt
      return anchor >= start && anchor <= end
    })
    .sort((a, b) => (b.completedAt ?? b.startedAt).localeCompare(a.completedAt ?? a.startedAt))
}

export function activeTasks(tasks: Task[], personId: string, lens: Lens): Task[] {
  return tasks
    .filter((task) => (lens === "dev" ? task.devId : task.pmId) === personId && task.status === "in_progress")
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

export function reviewFor(reviews: Review[], taskId: string, direction: Review["direction"]): Review | undefined {
  return reviews.find((review) => review.taskId === taskId && review.direction === direction)
}

export function reviewAverage(review: Review, aspects: Aspect[]): number | null {
  return average(aspects.map((aspect) => review.scores[aspect.id]).filter((value): value is number => typeof value === "number"))
}

export function reviewMean(review: Review): number | null {
  return reviewAverage(review, aspectsFor(review.direction))
}

export function receivedReviews(reviews: Review[], tasks: Task[], personId: string, lens: Lens): Review[] {
  const direction = directionFor(lens)
  const ids = new Set(tasks.map((task) => task.id))
  return reviews.filter((review) => ids.has(review.taskId) && review.direction === direction && review.rateeId === personId)
}

/** Period reviews where the person rated or was rated (PM↔Dev). */
export function involvedReviews(reviews: Review[], tasks: Task[], personId: string): Review[] {
  const ids = new Set(tasks.map((task) => task.id))
  return reviews
    .filter((review) => ids.has(review.taskId) && (review.raterId === personId || review.rateeId === personId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function aspectAverage(reviews: Review[], aspectId: AspectId): number | null {
  return average(reviews.map((review) => review.scores[aspectId]).filter((value): value is number => typeof value === "number"))
}

export type Insight =
  | { kind: "few" }
  | { kind: "even" }
  | {
      kind: "gap"
      weakest: Aspect
      weakestAverage: number
      strongest: Aspect
      strongestAverage: number
      mentions: { taskId: string; detail: string; score: number }[]
    }

export function buildInsight(reviews: Review[], aspects: Aspect[]): Insight {
  if (reviews.length < 2) return { kind: "few" }

  const stats = aspects.map((aspect) => {
    const scores = reviews.map((review) => review.scores[aspect.id]).filter((value): value is number => typeof value === "number")
    return {
      aspect,
      average: average(scores) ?? 0,
      min: scores.length ? Math.min(...scores) : 5,
      lows: scores.filter((score) => score <= 3).length,
    }
  })

  const maxAverage = Math.max(...stats.map((item) => item.average))
  const minAverage = Math.min(...stats.map((item) => item.average))
  if (maxAverage - minAverage < 0.5) return { kind: "even" }

  const weakestPool = stats.filter((item) => item.average <= minAverage + 0.05)
  weakestPool.sort(
    (a, b) =>
      a.min - b.min || b.lows - a.lows || aspects.findIndex((aspect) => aspect.id === a.aspect.id) - aspects.findIndex((aspect) => aspect.id === b.aspect.id),
  )
  const weakest = weakestPool[0]
  const strongest = stats.reduce((best, item) => (item.average > best.average ? item : best))
  const mentions = reviews
    .filter((review) => (review.scores[weakest.aspect.id] ?? 5) <= 3 && review.detail.trim())
    .map((review) => ({
      taskId: review.taskId,
      detail: review.detail,
      score: review.scores[weakest.aspect.id] as number,
    }))

  return {
    kind: "gap",
    weakest: weakest.aspect,
    weakestAverage: weakest.average,
    strongest: strongest.aspect,
    strongestAverage: strongest.average,
    mentions,
  }
}

export function aspectsForLens(lens: Lens): Aspect[] {
  return aspectsFor(directionFor(lens))
}

import { aspectsFor } from "../aspects"
import type { Person, Review } from "../types"

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function stars(score: number): string {
  return `${"★".repeat(score)}${"☆".repeat(5 - score)}`
}

export function reviewCommentHtml(review: Review, rater: Person, ratee: Person): string {
  const aspects = aspectsFor(review.direction)
  const title = review.direction === "pm_to_dev" ? "Review PM → Dev" : "Review Dev → PM"
  const lines = aspects
    .map((aspect) => {
      const score = review.scores[aspect.id]
      if (typeof score !== "number") return null
      return `<li><strong>${escapeHtml(aspect.label)}:</strong> ${stars(score)} (${score}/5)</li>`
    })
    .filter(Boolean)
    .join("")

  return [
    `<p><strong>Task Rank · ${escapeHtml(title)}</strong></p>`,
    `<p>${escapeHtml(rater.name)} rates ${escapeHtml(ratee.name)}</p>`,
    `<ul>${lines}</ul>`,
    `<p>${escapeHtml(review.detail)}</p>`,
  ].join("")
}

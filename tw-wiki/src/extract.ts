import type { TwComment, TwTask } from "./types"

const NOTES_RE = /(?:internal|technical)\s*notes/i

export function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

export function commentText(comment: TwComment): string {
  return stripHtml(comment.body ?? comment.content ?? comment.html ?? comment.htmlBody ?? comment["html-body"] ?? "")
}

export function hasTechnicalNotes(text: string): boolean {
  return NOTES_RE.test(text)
}

export function extractNotesBody(text: string): string {
  const match = text.match(/(?:internal|technical)\s*notes\s*[:\-]?\s*([\s\S]+)/i)
  if (match?.[1]) return match[1].trim()
  return text.trim()
}

export function isGgBaileyProject(name: string): boolean {
  const compact = name.toLowerCase().replace(/[^a-z0-9]/g, "")
  return compact.includes("ggbailey")
}

export function siteNameFromProject(projectName: string): string {
  const cleaned = projectName.replace(/\s*[|–—-]\s*.*$/, "").trim()
  return cleaned || projectName.trim() || "Untitled site"
}

export function siteIdFromName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "site"
}

export function notesFromTask(task: TwTask, comments: TwComment[]): { text: string; commentId: string | null } | null {
  const noteComments = comments.filter((comment) => hasTechnicalNotes(commentText(comment)))
  if (noteComments.length) {
    const text = noteComments.map((comment) => extractNotesBody(commentText(comment))).join("\n\n")
    return { text, commentId: noteComments[0].id != null ? String(noteComments[0].id) : null }
  }
  const description = stripHtml(task.description ?? "")
  if (hasTechnicalNotes(description)) {
    return { text: extractNotesBody(description), commentId: null }
  }
  return null
}

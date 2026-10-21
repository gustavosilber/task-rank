import type { TwComment, TwProject, TwTask } from "./types"

export class TeamworkError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export function teamworkConnection() {
  const siteUrl = (import.meta.env.VITE_TEAMWORK_SITE_URL as string | undefined)?.trim() || "https://bestworldsweb.teamwork.com"
  const apiKey = (import.meta.env.VITE_TEAMWORK_API_KEY as string | undefined)?.trim() ?? ""
  return { siteUrl, apiKey }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function request<T>(path: string, attempt = 0): Promise<T> {
  const { siteUrl, apiKey } = teamworkConnection()
  if (!apiKey) throw new TeamworkError("VITE_TEAMWORK_API_KEY is missing from the parent .env.", 400)
  const target = path.startsWith("/") ? path : `/${path}`
  const response = await fetch(`/api/teamwork${target}`, {
    headers: {
      Accept: "application/json",
      "X-Teamwork-Site": siteUrl,
      "X-Teamwork-Token": apiKey,
    },
  })
  if (response.status === 429 && attempt < 6) {
    const retryAfter = Number(response.headers.get("Retry-After"))
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * 2 ** attempt
    await sleep(Math.min(wait, 20000))
    return request<T>(path, attempt + 1)
  }
  const text = await response.text()
  let payload: unknown = text
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = text
  }
  if (!response.ok) {
    const detail =
      typeof payload === "object" && payload && "MESSAGE" in payload
        ? String((payload as { MESSAGE: string }).MESSAGE)
        : response.status === 429
          ? "Teamwork rate limit (429): too many requests. Wait a minute and sync again."
          : `Teamwork responded ${response.status}`
    throw new TeamworkError(detail, response.status)
  }
  return payload as T
}

function pickList<T>(data: Record<string, unknown>, keys: string[]): T[] {
  for (const key of keys) {
    const value = data[key]
    if (Array.isArray(value)) return value as T[]
  }
  return []
}

async function fetchAll<T>(path: string, keys: string[]): Promise<T[]> {
  const items: T[] = []
  let page = 1
  while (page <= 40) {
    const separator = path.includes("?") ? "&" : "?"
    const data = await request<Record<string, unknown>>(`${path}${separator}page=${page}&pageSize=100`)
    const chunk = pickList<T>(data, keys)
    if (chunk.length === 0) break
    items.push(...chunk)
    const hasMore =
      typeof data.meta === "object" &&
      data.meta != null &&
      typeof (data.meta as { page?: { hasMore?: boolean } }).page === "object" &&
      (data.meta as { page: { hasMore?: boolean } }).page?.hasMore === true
    if (!hasMore && chunk.length < 100) break
    page += 1
  }
  return items
}

export async function fetchProjects(): Promise<TwProject[]> {
  return fetchAll<TwProject>("/projects/api/v3/projects.json?projectStatuses=active", ["projects"])
}

export async function fetchProjectTasks(projectId: string): Promise<TwTask[]> {
  const tasks = await fetchAll<TwTask>(
    `/projects/api/v3/projects/${projectId}/tasks.json?includeCompletedTasks=false`,
    ["tasks"],
  )
  return tasks
    .filter((task) => {
      if (task.completed === true) return false
      const status = String(task.status ?? "").toLowerCase()
      return status !== "completed" && status !== "complete"
    })
    .map((task) => ({ ...task, projectId: task.projectId ?? projectId }))
}

export async function fetchTaskComments(taskId: string): Promise<TwComment[]> {
  const internal = await fetchAll<TwComment>(
    `/projects/api/v3/tasks/${taskId}/comments.json?searchTerm=Internal%20Notes&orderMode=desc`,
    ["comments"],
  )
  if (internal.length) return internal
  return fetchAll<TwComment>(
    `/projects/api/v3/tasks/${taskId}/comments.json?searchTerm=Internal%20Note&orderMode=desc`,
    ["comments"],
  )
}

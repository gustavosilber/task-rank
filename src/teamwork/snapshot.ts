import type { Person, Project, Task } from "../types"

export class SnapshotApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export type WorkspaceSnapshot = {
  people: Person[]
  projects: Project[]
  tasks: Task[]
  syncedAt: string | null
  lastStatus: string
  lastError: string | null
  running: boolean
}

async function parseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string }
    if (payload.error) return payload.error
  } catch {
    // ignore
  }
  if (response.status === 401) return "Google session expired. Sign in again."
  if (response.status === 409) return "A Teamwork sync is already running."
  if (response.status === 503) return "The Teamwork snapshot database is not configured yet."
  return "Could not reach the Teamwork snapshot."
}

function authHeaders(credential: string, json = false): HeadersInit {
  return {
    Authorization: `Bearer ${credential}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  }
}

export async function fetchWorkspaceSnapshot(credential: string): Promise<WorkspaceSnapshot> {
  const response = await fetch("/api/workspace", { headers: authHeaders(credential) })
  if (!response.ok) throw new SnapshotApiError(await parseError(response), response.status)
  const payload = (await response.json()) as Partial<WorkspaceSnapshot> & { error?: string }
  return {
    people: Array.isArray(payload.people) ? payload.people : [],
    projects: Array.isArray(payload.projects) ? payload.projects : [],
    tasks: Array.isArray(payload.tasks) ? payload.tasks : [],
    syncedAt: typeof payload.syncedAt === "string" ? payload.syncedAt : null,
    lastStatus: typeof payload.lastStatus === "string" ? payload.lastStatus : "never",
    lastError: typeof payload.lastError === "string" ? payload.lastError : null,
    running: Boolean(payload.running),
  }
}

export async function triggerTeamworkSync(
  credential: string,
  defaultPmId?: string,
): Promise<{ message: string; tasks: number; syncedAt?: string }> {
  const response = await fetch("/api/sync", {
    method: "POST",
    headers: authHeaders(credential, true),
    body: JSON.stringify({ defaultPmId: defaultPmId ?? "" }),
  })
  if (!response.ok) throw new SnapshotApiError(await parseError(response), response.status)
  const payload = (await response.json()) as { message?: string; tasks?: number; syncedAt?: string }
  return {
    message: payload.message || "Teamwork snapshot updated.",
    tasks: typeof payload.tasks === "number" ? payload.tasks : 0,
    syncedAt: payload.syncedAt,
  }
}

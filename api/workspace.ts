import { neon } from "@neondatabase/serverless"
import type { VercelRequest, VercelResponse } from "@vercel/node"

type Role = "PM" | "Dev"
type Person = { id: string; name: string; role: Role; email?: string }
type Project = { id: string; name: string; color: string }
type Task = {
  id: string
  title: string
  summary: string
  projectId: string
  devId: string
  pmId: string
  devIds?: string[]
  pmIds?: string[]
  assigneeIds?: string[]
  status: "in_progress" | "completed"
  startedAt: string
  completedAt: string | null
}
type AuthUser = { email: string; name: string; isSuperUser: boolean }
type Snapshot = {
  people: Person[]
  projects: Project[]
  tasks: Task[]
  syncedAt: string | null
  lastStatus: string
  lastError: string | null
  running: boolean
}

export type WorkspaceRequest = { method: string; authorization: string }
export type WorkspaceResponse = { status: number; body: unknown }

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

async function ensureSnapshotSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const query = sql()
      await query`
        CREATE TABLE IF NOT EXISTS tw_people (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          role TEXT NOT NULL,
          email TEXT NOT NULL DEFAULT '',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `
      await query`
        CREATE TABLE IF NOT EXISTS tw_projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          color TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `
      await query`
        CREATE TABLE IF NOT EXISTS tw_tasks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL,
          started_at TEXT NOT NULL,
          completed_at TEXT,
          dev_id TEXT NOT NULL,
          pm_id TEXT NOT NULL,
          dev_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          pm_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          assignee_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          active BOOLEAN NOT NULL DEFAULT true,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `
      await query`CREATE INDEX IF NOT EXISTS tw_tasks_project_id_idx ON tw_tasks (project_id)`
      await query`CREATE INDEX IF NOT EXISTS tw_tasks_active_idx ON tw_tasks (active)`
      await query`
        CREATE TABLE IF NOT EXISTS sync_state (
          id TEXT PRIMARY KEY,
          running_since TIMESTAMPTZ,
          last_started_at TIMESTAMPTZ,
          last_finished_at TIMESTAMPTZ,
          last_status TEXT NOT NULL DEFAULT 'never',
          last_error TEXT,
          default_pm_id TEXT NOT NULL DEFAULT '',
          people_count INTEGER NOT NULL DEFAULT 0,
          project_count INTEGER NOT NULL DEFAULT 0,
          task_count INTEGER NOT NULL DEFAULT 0
        )
      `
      await query`
        CREATE TABLE IF NOT EXISTS reviews (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          direction TEXT NOT NULL,
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
      await query`INSERT INTO sync_state (id, last_status) VALUES ('default', 'never') ON CONFLICT (id) DO NOTHING`
    })().catch((error) => {
      schemaReady = null
      throw error
    })
  }
  await schemaReady
}

async function verifyGoogleUser(authorization: string): Promise<AuthUser> {
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : ""
  if (!token) throw new HttpError(401, "Sign in with Google to load the Teamwork snapshot.")
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
    throw new HttpError(401, payload.error_description || payload.error || "Google session expired. Sign in again.")
  }
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || process.env.VITE_GOOGLE_CLIENT_ID?.trim() || ""
  if (clientId && payload.aud !== clientId) throw new HttpError(401, "Google token does not match this app.")
  if (payload.email_verified === false || payload.email_verified === "false") {
    throw new HttpError(401, "The Google email is not verified.")
  }
  const email = payload.email.trim().toLowerCase()
  return { email, name: payload.name?.trim() || email, isSuperUser: isSuperUserEmail(email) }
}

function uniqueIds(ids: Array<string | undefined | null>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function taskDevIds(task: Task): string[] {
  return uniqueIds(task.devIds?.length ? task.devIds : [task.devId])
}

function taskPmIds(task: Task): string[] {
  return uniqueIds(task.pmIds?.length ? task.pmIds : [task.pmId])
}

function isOnTask(task: Task, personId: string): boolean {
  return taskDevIds(task).includes(personId) || taskPmIds(task).includes(personId) || (task.assigneeIds ?? []).includes(personId)
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.length > 0)
}

type PersonRow = { id: string; name: string; role: Role; email: string }
type ProjectRow = { id: string; name: string; color: string }
type TaskRow = {
  id: string
  project_id: string
  title: string
  summary: string
  status: "in_progress" | "completed"
  started_at: string
  completed_at: string | null
  dev_id: string
  pm_id: string
  dev_ids: unknown
  pm_ids: unknown
  assignee_ids: unknown
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    projectId: row.project_id,
    devId: row.dev_id,
    pmId: row.pm_id,
    devIds: asStringArray(row.dev_ids),
    pmIds: asStringArray(row.pm_ids),
    assigneeIds: asStringArray(row.assignee_ids),
    status: row.status === "completed" ? "completed" : "in_progress",
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }
}

type StateRow = {
  running_since: string | Date | null
  last_finished_at: string | Date | null
  last_status: string
  last_error: string | null
}

function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

async function loadSnapshot(): Promise<Snapshot> {
  await ensureSnapshotSchema()
  const query = sql()
  const [people, projects, tasks, state] = await Promise.all([
    query`SELECT id, name, role, email FROM tw_people`,
    query`SELECT id, name, color FROM tw_projects`,
    query`
      SELECT id, project_id, title, summary, status, started_at, completed_at, dev_id, pm_id, dev_ids, pm_ids, assignee_ids
      FROM tw_tasks
      WHERE active = true
         OR id IN (SELECT DISTINCT task_id FROM reviews)
    `,
    query`SELECT running_since, last_finished_at, last_status, last_error FROM sync_state WHERE id = 'default'`,
  ])
  const current = (state as StateRow[])[0]
  return {
    people: (people as PersonRow[]).map((row) => ({ id: row.id, name: row.name, role: row.role, email: row.email || undefined })),
    projects: projects as ProjectRow[],
    tasks: (tasks as TaskRow[]).map(toTask),
    syncedAt: toIso(current?.last_finished_at),
    lastStatus: current?.last_status ?? "never",
    lastError: current?.last_error ?? null,
    running: Boolean(current?.running_since),
  }
}

function scopeSnapshot(snapshot: Snapshot, user: AuthUser): Snapshot {
  if (user.isSuperUser) return snapshot
  const person = snapshot.people.find((item) => (item.email ?? "").trim().toLowerCase() === user.email)
  if (!person) {
    return { ...snapshot, people: [], projects: [], tasks: [] }
  }
  const tasks = snapshot.tasks.filter((task) => isOnTask(task, person.id))
  const ids = new Set(tasks.flatMap((task) => [...taskDevIds(task), ...taskPmIds(task), ...(task.assigneeIds ?? []), person.id]))
  return {
    ...snapshot,
    people: snapshot.people.filter((item) => ids.has(item.id)),
    projects: snapshot.projects.filter((project) => tasks.some((task) => task.projectId === project.id)),
    tasks,
  }
}

export async function handleWorkspaceRequest(request: WorkspaceRequest): Promise<WorkspaceResponse> {
  try {
    if (!databaseUrl()) throw new HttpError(503, "DATABASE_URL is not set. Add a Neon connection string.")
    if (request.method.toUpperCase() !== "GET") throw new HttpError(405, "Method not allowed.")
    const user = await verifyGoogleUser(request.authorization)
    const snapshot = scopeSnapshot(await loadSnapshot(), user)
    return { status: 200, body: snapshot }
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    const message = error instanceof Error ? error.message : "Could not load the Teamwork snapshot."
    return { status, body: { error: message } }
  }
}

function headerOf(req: VercelRequest | Request, name: string): string {
  if (typeof Headers !== "undefined" && req.headers instanceof Headers) return req.headers.get(name) ?? ""
  const value = (req as VercelRequest).headers[name]
  return typeof value === "string" ? value : Array.isArray(value) ? value[0] ?? "" : ""
}

export default async function handler(req: VercelRequest | Request, res?: VercelResponse) {
  try {
    const result = await handleWorkspaceRequest({
      method: req.method ?? "GET",
      authorization: headerOf(req, "authorization"),
    })
    if (res && typeof res.status === "function") {
      res.status(result.status).json(result.body)
      return
    }
    return Response.json(result.body, { status: result.status })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load the Teamwork snapshot."
    if (res && typeof res.status === "function") {
      res.status(500).json({ error: message })
      return
    }
    return Response.json({ error: message }, { status: 500 })
  }
}

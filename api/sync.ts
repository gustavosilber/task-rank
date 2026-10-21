import { neon } from "@neondatabase/serverless"
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { isOnTask, taskDevIds, taskPmIds } from "../src/model"
import { mapWorkspace } from "../src/teamwork/map"
import type { TwPerson, TwProject, TwTask, TwTasklist } from "../src/teamwork/types"
import type { Person, Project, Task } from "../src/types"

export const config = { maxDuration: 60 }

type AuthUser = { email: string; name: string; isSuperUser: boolean }

export type Snapshot = {
  people: Person[]
  projects: Project[]
  tasks: Task[]
  syncedAt: string | null
  lastStatus: string
  lastError: string | null
  running: boolean
}

export type ApiRequest = { method: string; authorization: string; cron: boolean; body: string }
export type ApiResponse = { status: number; body: unknown }

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

export async function ensureSnapshotSchema() {
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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.length > 0)
}

type PersonRow = { id: string; name: string; role: "PM" | "Dev"; email: string }
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

export async function loadSnapshot(): Promise<Snapshot> {
  await ensureSnapshotSchema()
  const query = sql()
  const [people, projects, tasks, state] = await Promise.all([
    query`SELECT id, name, role, email FROM tw_people` as Promise<PersonRow[]>,
    query`SELECT id, name, color FROM tw_projects` as Promise<ProjectRow[]>,
    query`
      SELECT id, project_id, title, summary, status, started_at, completed_at, dev_id, pm_id, dev_ids, pm_ids, assignee_ids
      FROM tw_tasks
      WHERE active = true
         OR id IN (SELECT DISTINCT task_id FROM reviews)
    ` as Promise<TaskRow[]>,
    query`SELECT running_since, last_finished_at, last_status, last_error FROM sync_state WHERE id = 'default'` as Promise<StateRow[]>,
  ])
  const current = state[0]
  return {
    people: people.map((row) => ({ id: row.id, name: row.name, role: row.role, email: row.email || undefined })),
    projects,
    tasks: tasks.map(toTask),
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

function teamworkConfig(): { site: string; apiKey: string } {
  const site = (process.env.TEAMWORK_SITE_URL?.trim() || process.env.VITE_TEAMWORK_SITE_URL?.trim() || "https://bestworldsweb.teamwork.com").replace(
    /\/+$/,
    "",
  )
  const apiKey = (process.env.TEAMWORK_API_KEY?.trim() || process.env.VITE_TEAMWORK_API_KEY?.trim() || "").trim()
  if (!apiKey) throw new HttpError(503, "TEAMWORK_API_KEY is not set on the server.")
  return { site, apiKey }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function teamworkGet(path: string, attempt = 0): Promise<Record<string, unknown>> {
  const { site, apiKey } = teamworkConfig()
  const target = new URL(path.startsWith("/") ? path : `/${path}`, `${site}/`)
  const response = await fetch(target, {
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${apiKey}:xxx`).toString("base64")}`,
    },
  })
  if (response.status === 429 && attempt < 1) {
    const retryAfter = Number(response.headers.get("Retry-After") || "2")
    await sleep(Math.min(Number.isFinite(retryAfter) ? retryAfter * 1000 : 2000, 4000))
    return teamworkGet(path, attempt + 1)
  }
  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "MESSAGE" in payload
        ? String((payload as { MESSAGE: string }).MESSAGE)
        : `Teamwork responded with ${response.status}`
    throw new HttpError(response.status, message)
  }
  return (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>
}

function pickList(data: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = data[key]
    if (Array.isArray(value)) return value
  }
  return []
}

function peopleFromIncluded(included: unknown): TwPerson[] {
  if (!included || typeof included !== "object") return []
  const bag = included as Record<string, unknown>
  const users = bag.users ?? bag.people
  if (Array.isArray(users)) return users as TwPerson[]
  if (users && typeof users === "object") return Object.values(users as Record<string, TwPerson>)
  return []
}

function projectsFromIncluded(included: unknown): TwProject[] {
  if (!included || typeof included !== "object") return []
  const bag = included as Record<string, unknown>
  const projects = bag.projects
  if (Array.isArray(projects)) return projects as TwProject[]
  if (projects && typeof projects === "object") return Object.values(projects as Record<string, TwProject>)
  return []
}

async function fetchAllPages(path: string, keys: string[], pageSize = 250) {
  const items: unknown[] = []
  const includedPeople: TwPerson[] = []
  const includedProjects: TwProject[] = []
  let page = 1
  while (page <= 40) {
    const separator = path.includes("?") ? "&" : "?"
    const data = await teamworkGet(`${path}${separator}page=${page}&pageSize=${pageSize}`)
    const chunk = pickList(data, keys)
    includedPeople.push(...peopleFromIncluded(data.included))
    includedProjects.push(...projectsFromIncluded(data.included))
    if (chunk.length === 0) break
    items.push(...chunk)
    const hasMore =
      typeof data.meta === "object" &&
      data.meta != null &&
      typeof (data.meta as { page?: { hasMore?: boolean } }).page === "object" &&
      (data.meta as { page: { hasMore?: boolean } }).page?.hasMore === true
    if (!hasMore && chunk.length < pageSize) break
    page += 1
  }
  return { items, includedPeople, includedProjects }
}

async function persistSnapshot(people: Person[], projects: Project[], tasks: Task[]) {
  const query = sql() as ReturnType<typeof sql> & { query: (text: string, params?: unknown[]) => Promise<unknown> }
  if (people.length > 0) {
    await query.query(
      `INSERT INTO tw_people (id, name, role, email, updated_at)
       SELECT id, name, role, COALESCE(email, ''), now()
       FROM json_to_recordset($1::json) AS t(id text, name text, role text, email text)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, email = EXCLUDED.email, updated_at = now()`,
      [JSON.stringify(people.map((person) => ({ id: person.id, name: person.name, role: person.role, email: person.email ?? "" })))],
    )
  }
  if (projects.length > 0) {
    await query.query(
      `INSERT INTO tw_projects (id, name, color, updated_at)
       SELECT id, name, color, now()
       FROM json_to_recordset($1::json) AS t(id text, name text, color text)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color, updated_at = now()`,
      [JSON.stringify(projects)],
    )
  }
  if (tasks.length > 0) {
    await query.query(
      `INSERT INTO tw_tasks (
          id, project_id, title, summary, status, started_at, completed_at, dev_id, pm_id, dev_ids, pm_ids, assignee_ids, active, updated_at
        )
       SELECT id, project_id, title, summary, status, started_at, completed_at, dev_id, pm_id, dev_ids::jsonb, pm_ids::jsonb, assignee_ids::jsonb, true, now()
       FROM json_to_recordset($1::json) AS t(
          id text, project_id text, title text, summary text, status text, started_at text, completed_at text,
          dev_id text, pm_id text, dev_ids json, pm_ids json, assignee_ids json
       )
       ON CONFLICT (id) DO UPDATE SET
          project_id = EXCLUDED.project_id,
          title = EXCLUDED.title,
          summary = EXCLUDED.summary,
          status = EXCLUDED.status,
          started_at = EXCLUDED.started_at,
          completed_at = EXCLUDED.completed_at,
          dev_id = EXCLUDED.dev_id,
          pm_id = EXCLUDED.pm_id,
          dev_ids = EXCLUDED.dev_ids,
          pm_ids = EXCLUDED.pm_ids,
          assignee_ids = EXCLUDED.assignee_ids,
          active = true,
          updated_at = now()`,
      [
        JSON.stringify(
          tasks.map((task) => ({
            id: task.id,
            project_id: task.projectId,
            title: task.title,
            summary: task.summary,
            status: task.status,
            started_at: task.startedAt,
            completed_at: task.completedAt,
            dev_id: task.devId,
            pm_id: task.pmId,
            dev_ids: task.devIds ?? [task.devId],
            pm_ids: task.pmIds ?? [task.pmId],
            assignee_ids: task.assigneeIds ?? [],
          })),
        ),
      ],
    )
    const ids = tasks.map((task) => task.id)
    await query.query(`UPDATE tw_tasks SET active = false, updated_at = now() WHERE NOT (id = ANY($1::text[])) AND active = true`, [ids])
  }
}

function tasklistProjectMap(tasklists: TwTasklist[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const list of tasklists) {
    if (list.id == null) continue
    const projectId = list.projectId ?? list.project?.id
    if (projectId == null || String(projectId) === "") continue
    map.set(String(list.id), String(projectId))
  }
  return map
}

async function crawlTeamwork(defaultPmId: string) {
  const [peoplePage, projectPage] = await Promise.all([
    fetchAllPages("/projects/api/v3/people.json?includeClients=false&excludeContacts=true&includeCollaborators=true", ["people", "users"], 100),
    fetchAllPages("/projects/api/v3/projects.json?projectStatuses=active", ["projects"], 100),
  ])
  const projects = [...(projectPage.items as TwProject[]), ...projectPage.includedProjects]
  const taskPage = await fetchAllPages(
    "/projects/api/v3/tasks.json?includeCompletedTasks=true&include=projects,users,tasklists",
    ["tasks"],
    250,
  )
  let tasklistToProject = new Map<string, string>()
  if (taskPage.items.length === 0 || (taskPage.items as TwTask[]).some((task) => task.projectId == null && !task.project)) {
    const lists = await fetchAllPages("/projects/api/v3/tasklists.json?includeCompletedTasklists=true&include=projects", ["tasklists"], 250)
    tasklistToProject = tasklistProjectMap(lists.items as TwTasklist[])
  }
  return mapWorkspace(
    [...(peoplePage.items as TwPerson[]), ...peoplePage.includedPeople, ...taskPage.includedPeople],
    [...projects, ...taskPage.includedProjects],
    taskPage.items as TwTask[],
    defaultPmId,
    tasklistToProject,
  )
}

async function runSnapshotSync(defaultPmId?: string) {
  await ensureSnapshotSchema()
  const query = sql()
  if (typeof defaultPmId === "string") {
    await query`UPDATE sync_state SET default_pm_id = ${defaultPmId} WHERE id = 'default'`
  }
  const locked = (await query`
    UPDATE sync_state
    SET running_since = now(), last_started_at = now(), last_status = 'running', last_error = NULL
    WHERE id = 'default'
      AND (running_since IS NULL OR running_since < now() - interval '20 minutes')
    RETURNING default_pm_id
  `) as { default_pm_id: string }[]
  if (locked.length === 0) throw new HttpError(409, "A Teamwork sync is already running.")
  const pmId = defaultPmId?.trim() || locked[0]?.default_pm_id || ""
  try {
    const mapped = await crawlTeamwork(pmId)
    if (mapped.tasks.length === 0) {
      throw new HttpError(
        502,
        `Found ${mapped.diagnostics.rawProjects} active projects and ${mapped.diagnostics.rawTasks} tasks, but none were usable.`,
      )
    }
    await persistSnapshot(mapped.people, mapped.projects, mapped.tasks)
    await query`
      UPDATE sync_state
      SET running_since = NULL,
          last_finished_at = now(),
          last_status = 'ok',
          last_error = NULL,
          people_count = ${mapped.people.length},
          project_count = ${mapped.projects.length},
          task_count = ${mapped.tasks.length}
      WHERE id = 'default'
    `
    return {
      message: `Synced ${mapped.tasks.length} tasks from ${mapped.projects.length} active projects (${mapped.people.length} people). Ratings stay in Task Rank.`,
      people: mapped.people.length,
      projects: mapped.projects.length,
      tasks: mapped.tasks.length,
      syncedAt: new Date().toISOString(),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Teamwork sync failed."
    await query`
      UPDATE sync_state
      SET running_since = NULL, last_finished_at = now(), last_status = 'error', last_error = ${message}
      WHERE id = 'default'
    `
    throw error
  }
}

function cronAuthorized(request: ApiRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  const bearer = request.authorization.startsWith("Bearer ") ? request.authorization.slice(7).trim() : ""
  if (secret && bearer && bearer === secret) return true
  return request.cron
}

export async function handleSyncRequest(request: ApiRequest): Promise<ApiResponse> {
  try {
    if (!databaseUrl()) throw new HttpError(503, "DATABASE_URL is not set. Add a Neon connection string.")
    const method = request.method.toUpperCase()
    if (method !== "GET" && method !== "POST") throw new HttpError(405, "Method not allowed.")
    let defaultPmId: string | undefined
    if (!cronAuthorized(request)) {
      const user = await verifyGoogleUser(request.authorization)
      if (!user.isSuperUser) throw new HttpError(403, "Only an admin can run a Teamwork sync.")
      if (request.body.trim()) {
        try {
          const payload = JSON.parse(request.body) as { defaultPmId?: unknown }
          if (typeof payload.defaultPmId === "string") defaultPmId = payload.defaultPmId
        } catch {
          // ignore
        }
      }
    }
    const result = await runSnapshotSync(defaultPmId)
    return { status: 200, body: result }
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    const message = error instanceof Error ? error.message : "Could not sync Teamwork."
    return { status, body: { error: message } }
  }
}

export async function handleWorkspaceRequest(request: ApiRequest): Promise<ApiResponse> {
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const body = typeof req.body === "string" ? req.body : req.body == null ? "" : JSON.stringify(req.body)
  const result = await handleSyncRequest({
    method: req.method ?? "GET",
    authorization: String(req.headers.authorization ?? ""),
    cron: String(req.headers["x-vercel-cron"] ?? "") === "1",
    body,
  })
  res.status(result.status).json(result.body)
}

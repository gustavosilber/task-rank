import { neon } from "@neondatabase/serverless"
import type { VercelRequest, VercelResponse } from "@vercel/node"

export const config = { maxDuration: 60 }

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
type TwPerson = {
  id: number | string
  firstName?: string
  lastName?: string
  "first-name"?: string
  "last-name"?: string
  fullName?: string
  name?: string
  title?: string
  email?: string
  "email-address"?: string
  deleted?: boolean
  type?: string
  userType?: string
}
type TwProject = { id: number | string; name?: string; status?: string; projectStatus?: string }
type TwTasklist = { id: number | string; name?: string; projectId?: number | string; project?: { id?: number | string } }
type TwTask = {
  id: number | string
  name?: string
  description?: string
  status?: string
  completed?: boolean
  projectId?: number | string
  project?: { id?: number | string }
  tasklistId?: number | string
  tasklist?: { id?: number | string }
  "todo-list-id"?: number | string
  createdAt?: string
  updatedAt?: string
  startDate?: string
  startAt?: string
  dateCreated?: string
  "created-on"?: string
  completedAt?: string
  dateCompleted?: string
  completedDate?: string
  "completed-on"?: string
  createdBy?: number | string
  createdByUserId?: number | string
  "created-by-user-id"?: number | string
  responsiblePartyIds?: number[] | string
  responsiblePartyId?: number | string
  "responsible-party-ids"?: string
  "responsible-party-id"?: string | number
  assigneeUserIds?: Array<number | string>
  assignedToUserIds?: Array<number | string>
  assignees?: { userIds?: Array<number | string>; users?: Array<number | string | { id?: number | string }> }
}
type SyncDiagnostics = {
  rawPeople: number
  rawProjects: number
  rawTasks: number
  mappedPeople: number
  mappedProjects: number
  mappedTasks: number
  droppedNoProject: number
  droppedNoDev: number
  droppedUnknownProject: number
  sampleTaskKeys: string[]
  tasklists: number
  tasksWithAssignees: number
}

type AuthUser = { email: string; name: string; isSuperUser: boolean }

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

const PROJECT_COLORS = ["#315c8a", "#2c6b4a", "#a24b24", "#6b4a8a", "#8a6b31", "#2f6f7a", "#8a3d5b"]
const STUB_NAME = /^(Usuario|User) \d+$/

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
}

function toIsoDate(value: string | undefined | null): string | null {
  if (!value) return null
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/)
  if (match) return match[1]
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  const month = String(parsed.getMonth() + 1).padStart(2, "0")
  const day = String(parsed.getDate()).padStart(2, "0")
  return `${parsed.getFullYear()}-${month}-${day}`
}

function roleFromTitle(title: string | undefined): Role {
  if (!title) return "Dev"
  return /\b(pm|project manager|product manager|product owner|scrum master|delivery manager|account manager)\b/i.test(title)
    ? "PM"
    : "Dev"
}

function personName(person: TwPerson): string {
  const first = person.firstName ?? person["first-name"]
  const last = person.lastName ?? person["last-name"]
  const full = person.fullName ?? person.name
  const email = person.email ?? person["email-address"]
  return [first, last].filter(Boolean).join(" ").trim() || full?.trim() || email?.trim() || ""
}

function hasRealName(name: string): boolean {
  return Boolean(name) && !STUB_NAME.test(name)
}

function splitIds(value: unknown): string[] {
  if (value == null) return []
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "object" && item && "id" in item ? String((item as { id: unknown }).id ?? "") : String(item)))
      .map((id) => id.trim())
      .filter((id) => id && id !== "0" && id !== "-1")
  }
  if (typeof value === "number") return value > 0 ? [String(value)] : []
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[,\s]+/)
      .map((part) => part.trim())
      .filter((id) => id && id !== "0" && id !== "-1")
  }
  return []
}

function assigneeIds(task: TwTask): string[] {
  const candidates = [
    ...splitIds(task.assignees?.userIds),
    ...splitIds(task.assignees?.users),
    ...splitIds(task.assigneeUserIds),
    ...splitIds(task.assignedToUserIds),
    ...splitIds(task.responsiblePartyIds),
    ...splitIds(task.responsiblePartyId),
    ...splitIds(task["responsible-party-ids"]),
    ...splitIds(task["responsible-party-id"]),
  ]
  const seen = new Set<string>()
  const ids: string[] = []
  for (const id of candidates) {
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function tasklistId(task: TwTask): string {
  const value = task.tasklistId ?? task.tasklist?.id ?? task["todo-list-id"]
  return value != null && String(value) !== "" ? String(value) : ""
}

function taskProjectId(task: TwTask, tasklistToProject: Map<string, string>): string {
  if (task.projectId != null && String(task.projectId) !== "") return String(task.projectId)
  if (task.project?.id != null && String(task.project.id) !== "") return String(task.project.id)
  const listId = tasklistId(task)
  if (listId && tasklistToProject.has(listId)) return tasklistToProject.get(listId) as string
  return ""
}

function createdById(task: TwTask): string {
  const value = task.createdByUserId ?? task.createdBy ?? task["created-by-user-id"]
  return value != null && String(value) !== "" ? String(value) : ""
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function pickDevAndPmIds(
  task: TwTask,
  people: Person[],
  namedIds: Set<string>,
  defaultPmId: string,
): { devIds: string[]; pmIds: string[] } | null {
  const peopleById = new Map(people.map((person) => [person.id, person]))
  const assignees = uniqueIds(assigneeIds(task).filter((id) => namedIds.has(id)))
  const createdBy = createdById(task)
  const isPm = (id: string) => peopleById.get(id)?.role === "PM"
  const pmIds = uniqueIds([...assignees.filter(isPm), ...(createdBy && namedIds.has(createdBy) && isPm(createdBy) ? [createdBy] : [])])
  let devIds = uniqueIds(assignees.filter((id) => !pmIds.includes(id)))
  if (devIds.length === 0) devIds = assignees.slice()
  if (pmIds.length === 0) {
    if (createdBy && namedIds.has(createdBy)) pmIds.push(createdBy)
    else if (defaultPmId && namedIds.has(defaultPmId)) pmIds.push(defaultPmId)
  }
  if (devIds.length === 0 || pmIds.length === 0) return null
  return { devIds: uniqueIds(devIds), pmIds: uniqueIds(pmIds) }
}

function personEmail(person: TwPerson): string {
  return (person.email ?? person["email-address"] ?? "").trim().toLowerCase()
}

function mapPeople(raw: TwPerson[]): Person[] {
  const byId = new Map<string, Person>()
  for (const person of raw) {
    if (person.id == null || person.deleted || person.type === "contact" || person.userType === "contact") continue
    const name = personName(person)
    if (!hasRealName(name)) continue
    const id = String(person.id)
    if (byId.has(id)) continue
    const email = personEmail(person)
    byId.set(id, { id, name, role: roleFromTitle(person.title), ...(email ? { email } : {}) })
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "en"))
}

function mapProjects(raw: TwProject[]): Project[] {
  return raw
    .filter((project) => {
      if (project.id == null) return false
      const status = String(project.status ?? project.projectStatus ?? "active").toLowerCase()
      return !status || status === "active" || status === "current"
    })
    .map((project, index) => ({
      id: String(project.id),
      name: project.name?.trim() || `Project ${project.id}`,
      color: PROJECT_COLORS[index % PROJECT_COLORS.length],
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
}

function refineRoles(people: Person[], tasks: Task[]): Person[] {
  const asDev = new Set(tasks.flatMap((task) => (task.devIds?.length ? task.devIds : [task.devId])))
  const asPm = new Set(tasks.flatMap((task) => (task.pmIds?.length ? task.pmIds : [task.pmId])))
  return people.map((person) => {
    const mostlyPm = asPm.has(person.id) && !asDev.has(person.id)
    if (mostlyPm || person.role === "PM") return { ...person, role: mostlyPm ? "PM" : person.role }
    return { ...person, role: "Dev" }
  })
}

function mapWorkspace(
  rawPeople: TwPerson[],
  rawProjects: TwProject[],
  rawTasks: TwTask[],
  defaultPmId: string,
  tasklistToProject: Map<string, string> = new Map(),
): {
  people: Person[]
  projects: Project[]
  tasks: Task[]
  diagnostics: SyncDiagnostics
} {
  const people = mapPeople(rawPeople)
  const namedIds = new Set(people.map((person) => person.id))
  const projects = mapProjects(rawProjects)
  const activeProjectIds = new Set(projects.map((project) => project.id))

  const stampedTasks = rawTasks
    .map((task) => {
      const projectId = taskProjectId(task, tasklistToProject)
      return projectId && (task.projectId == null || String(task.projectId) === "") ? { ...task, projectId } : task
    })
    .filter((task) => {
      const projectId = taskProjectId(task, tasklistToProject)
      return projectId !== "" && activeProjectIds.has(projectId)
    })

  let droppedNoProject = 0
  let droppedNoDev = 0
  let droppedUnknownProject = 0
  let tasksWithAssignees = 0
  const sampleTask = stampedTasks.find((task) => assigneeIds(task).length > 0) ?? stampedTasks[0]
  const sampleTaskKeys = sampleTask ? Object.keys(sampleTask).sort() : []

  const tasks = stampedTasks
    .map((task) => {
      const projectId = taskProjectId(task, tasklistToProject)
      if (!projectId) {
        droppedNoProject += 1
        return null
      }
      if (!activeProjectIds.has(projectId)) {
        droppedUnknownProject += 1
        return null
      }

      if (assigneeIds(task).length > 0) tasksWithAssignees += 1

      const completed =
        task.completed === true ||
        String(task.status ?? "").toLowerCase() === "completed" ||
        Boolean(
          toIsoDate(task.completedAt) ||
            toIsoDate(task.dateCompleted) ||
            toIsoDate(task.completedDate) ||
            toIsoDate(task["completed-on"]),
        )

      const completedAt =
        toIsoDate(task.completedAt) || toIsoDate(task.dateCompleted) || toIsoDate(task.completedDate) || toIsoDate(task["completed-on"])
      const startedAt =
        toIsoDate(task.startDate) ||
        toIsoDate(task.startAt) ||
        toIsoDate(task.createdAt) ||
        toIsoDate(task.dateCreated) ||
        toIsoDate(task["created-on"]) ||
        completedAt ||
        toIsoDate(task.updatedAt) ||
        "1970-01-01"

      const roles = pickDevAndPmIds(task, people, namedIds, defaultPmId)
      if (!roles) {
        droppedNoDev += 1
        return null
      }

      const description = stripHtml(task.description ?? "")
      const assigneeIdsForTask = uniqueIds(assigneeIds(task).filter((id) => namedIds.has(id)))
      return {
        id: String(task.id),
        title: task.name?.trim() || `Task ${task.id}`,
        summary: description || "No description in Teamwork.",
        projectId,
        devId: roles.devIds[0],
        pmId: roles.pmIds[0],
        devIds: roles.devIds,
        pmIds: roles.pmIds,
        assigneeIds: assigneeIdsForTask,
        status: completed ? ("completed" as const) : ("in_progress" as const),
        startedAt,
        completedAt: completed ? completedAt || startedAt : null,
      }
    })
    .filter((task) => task != null)
    .sort((a, b) => (b.completedAt ?? b.startedAt).localeCompare(a.completedAt ?? a.startedAt))

  const usedPeople = new Set(
    tasks.flatMap((task) => [...(task.devIds ?? [task.devId]), ...(task.pmIds ?? [task.pmId]), ...(task.assigneeIds ?? [])]),
  )
  const refinedPeople = refineRoles(
    people.filter((person) => usedPeople.has(person.id)),
    tasks,
  )
  const visibleProjects = projects.filter((project) => tasks.some((task) => task.projectId === project.id))

  return {
    people: refinedPeople,
    projects: visibleProjects,
    tasks,
    diagnostics: {
      rawPeople: rawPeople.length,
      rawProjects: rawProjects.length,
      rawTasks: stampedTasks.length,
      mappedPeople: refinedPeople.length,
      mappedProjects: visibleProjects.length,
      mappedTasks: tasks.length,
      droppedNoProject,
      droppedNoDev,
      droppedUnknownProject,
      sampleTaskKeys,
      tasklists: tasklistToProject.size,
      tasksWithAssignees,
    },
  }
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

function isWebRequest(req: VercelRequest | Request): req is Request {
  return typeof Headers !== "undefined" && req.headers instanceof Headers
}

function headerOf(req: VercelRequest | Request, name: string): string {
  if (isWebRequest(req)) return req.headers.get(name) ?? ""
  const value = req.headers[name]
  return typeof value === "string" ? value : Array.isArray(value) ? value[0] ?? "" : ""
}

async function readBody(req: VercelRequest | Request): Promise<string> {
  if (isWebRequest(req)) return req.text()
  const body = req.body
  return typeof body === "string" ? body : body == null ? "" : JSON.stringify(body)
}

export default async function handler(req: VercelRequest | Request, res?: VercelResponse) {
  try {
    const result = await handleSyncRequest({
      method: req.method ?? "GET",
      authorization: headerOf(req, "authorization"),
      cron: headerOf(req, "x-vercel-cron") === "1",
      body: req.method === "GET" || req.method === "HEAD" ? "" : await readBody(req),
    })
    if (res && typeof res.status === "function") {
      res.status(result.status).json(result.body)
      return
    }
    return Response.json(result.body, { status: result.status })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not sync Teamwork."
    if (res && typeof res.status === "function") {
      res.status(500).json({ error: message })
      return
    }
    return Response.json({ error: message }, { status: 500 })
  }
}

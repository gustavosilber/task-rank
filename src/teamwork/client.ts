import type { TeamworkConnection, TwPerson, TwProject, TwTask, TwTasklist } from "./types"

export class TeamworkError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "TeamworkError"
    this.status = status
  }
}

function normalizeSite(siteUrl: string): string {
  const trimmed = siteUrl.trim().replace(/\/+$/, "")
  if (!trimmed) throw new TeamworkError("Teamwork site URL is missing.", 400)
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`)
    return `${url.protocol}//${url.host}`
  } catch {
    throw new TeamworkError("The site URL is not valid.", 400)
  }
}

function authHeaders(connection: TeamworkConnection): Record<string, string> {
  if (connection.authMode === "password") {
    return {
      "X-Teamwork-User": connection.email.trim(),
      "X-Teamwork-Password": connection.password,
    }
  }
  return { "X-Teamwork-Token": connection.apiKey.trim() }
}

function assertCredentials(connection: TeamworkConnection) {
  if (connection.authMode === "password") {
    if (!connection.email.trim() || !connection.password) {
      throw new TeamworkError("Teamwork email or password is missing.", 400)
    }
    return
  }
  if (!connection.apiKey.trim()) throw new TeamworkError("Teamwork API key is missing.", 400)
}

async function request<T>(connection: TeamworkConnection, path: string, init?: RequestInit): Promise<T> {
  assertCredentials(connection)
  const site = normalizeSite(connection.siteUrl)
  const target = path.startsWith("/") ? path : `/${path}`
  const response = await fetch(`/api/teamwork${target}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Teamwork-Site": site,
      ...authHeaders(connection),
      ...(init?.headers ?? {}),
    },
  })

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
    const detail =
      typeof payload === "object" && payload && "MESSAGE" in payload
        ? String((payload as { MESSAGE: string }).MESSAGE)
        : typeof payload === "string"
          ? payload.slice(0, 200)
          : `Teamwork responded with ${response.status}`
    throw new TeamworkError(detail || `Error ${response.status}`, response.status)
  }

  return payload as T
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function pickList<T>(data: Record<string, unknown>, keys: string[]): T[] {
  for (const key of keys) {
    const value = data[key]
    if (Array.isArray(value)) return value as T[]
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

async function fetchAllPages(
  connection: TeamworkConnection,
  path: string,
  keys: string[],
  pageSize = 100,
): Promise<{ items: unknown[]; includedPeople: TwPerson[]; includedProjects: TwProject[] }> {
  const items: unknown[] = []
  const includedPeople: TwPerson[] = []
  const includedProjects: TwProject[] = []
  let page = 1

  while (page <= 80) {
    const separator = path.includes("?") ? "&" : "?"
    const data = await request<Record<string, unknown>>(connection, `${path}${separator}page=${page}&pageSize=${pageSize}`)
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

function dedupeById<T extends { id?: number | string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    if (item.id == null) continue
    const id = String(item.id)
    if (seen.has(id)) continue
    seen.add(id)
    out.push(item)
  }
  return out
}

export type TeamworkMe = {
  id: string
  email: string
  name: string
}

export async function fetchMe(connection: TeamworkConnection): Promise<TeamworkMe> {
  const data = await request<{ person?: TwPerson & { emailAddress?: string } }>(connection, "/projects/api/v3/me.json")
  const person = data.person
  if (!person?.id) throw new TeamworkError("Teamwork did not return the logged-in user.", 500)
  const email = (person.email ?? person.emailAddress ?? person["email-address"] ?? connection.email ?? "").trim()
  const first = person.firstName ?? person["first-name"]
  const last = person.lastName ?? person["last-name"]
  const name =
    [first, last].filter(Boolean).join(" ").trim() ||
    person.fullName?.trim() ||
    person.name?.trim() ||
    email ||
    `User ${person.id}`
  return { id: String(person.id), email, name }
}

export async function testConnection(connection: TeamworkConnection): Promise<{ site: string; me: TeamworkMe; people: number }> {
  const site = normalizeSite(connection.siteUrl)
  const me = await fetchMe(connection)
  const { items } = await fetchAllPages(connection, "/projects/api/v3/people.json?includeClients=false&excludeContacts=true", ["people", "users"], 50)
  return { site, me, people: items.length }
}

export async function fetchPeople(connection: TeamworkConnection): Promise<TwPerson[]> {
  const { items, includedPeople } = await fetchAllPages(
    connection,
    "/projects/api/v3/people.json?includeClients=false&excludeContacts=true&includeCollaborators=true",
    ["people", "users"],
  )
  return dedupeById([...(items as TwPerson[]), ...includedPeople])
}

export async function fetchProjects(connection: TeamworkConnection): Promise<TwProject[]> {
  const primary = await fetchAllPages(connection, "/projects/api/v3/projects.json?projectStatuses=active", ["projects"])
  return dedupeById([...(primary.items as TwProject[]), ...primary.includedProjects])
}

export async function fetchTasklists(connection: TeamworkConnection): Promise<TwTasklist[]> {
  const result = await fetchAllPages(
    connection,
    "/projects/api/v3/tasklists.json?includeCompletedTasklists=true&include=projects",
    ["tasklists"],
  )
  return dedupeById(result.items as TwTasklist[])
}

export function tasklistProjectMap(tasklists: TwTasklist[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const list of tasklists) {
    if (list.id == null) continue
    const projectId = list.projectId ?? list.project?.id
    if (projectId == null || String(projectId) === "") continue
    map.set(String(list.id), String(projectId))
  }
  return map
}

export async function fetchTasks(connection: TeamworkConnection): Promise<{
  tasks: TwTask[]
  people: TwPerson[]
  projects: TwProject[]
}> {
  const result = await fetchAllPages(
    connection,
    "/projects/api/v3/tasks.json?includeCompletedTasks=true&include=projects,users,tasklists",
    ["tasks"],
  )
  return {
    tasks: asArray<TwTask>(result.items),
    people: dedupeById(result.includedPeople),
    projects: dedupeById(result.includedProjects),
  }
}

/** Fetch tasks only for the given (active) projects and stamp projectId. */
export async function fetchTasksByProject(
  connection: TeamworkConnection,
  projects: TwProject[],
): Promise<{ tasks: TwTask[]; people: TwPerson[] }> {
  const tasks: TwTask[] = []
  const people: TwPerson[] = []
  const batchSize = 5

  for (let i = 0; i < projects.length; i += batchSize) {
    const batch = projects.slice(i, i + batchSize)
    const pages = await Promise.all(
      batch.map((project) =>
        fetchAllPages(
          connection,
          `/projects/api/v3/projects/${project.id}/tasks.json?includeCompletedTasks=true&include=users`,
          ["tasks"],
          250,
        ),
      ),
    )
    pages.forEach((page, index) => {
      const projectId = batch[index].id
      people.push(...page.includedPeople)
      for (const item of page.items as TwTask[]) {
        tasks.push({ ...item, projectId: item.projectId ?? projectId })
      }
    })
  }

  return { tasks: dedupeById(tasks), people: dedupeById(people) }
}

export async function postTaskComment(
  connection: TeamworkConnection,
  taskId: string,
  bodyHtml: string,
  authorId?: string,
): Promise<{ id: string }> {
  const comment: Record<string, string | number | boolean> = {
    body: bodyHtml,
    "content-type": "html",
    notify: "",
  }
  if (authorId && /^\d+$/.test(authorId)) comment["author-id"] = Number(authorId)

  const data = await request<{ id?: string | number }>(connection, `/tasks/${taskId}/comments.json`, {
    method: "POST",
    body: JSON.stringify({ comment }),
  })

  return { id: String(data.id ?? "") }
}

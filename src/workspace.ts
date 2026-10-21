import { PEOPLE as DEMO_PEOPLE, PROJECTS as DEMO_PROJECTS, SEED_REVIEWS, TASKS as DEMO_TASKS } from "./data"
import type { Person, Project, Review, Task } from "./types"
import type { TeamworkConnection, TeamworkSession } from "./teamwork/types"
import { isSuperUserEmail } from "./teamwork/types"
import { envTeamworkConnection, isUsableConnection } from "./teamwork/config"

export type DataSource = "demo" | "teamwork"

export type Workspace = {
  source: DataSource
  people: Person[]
  projects: Project[]
  tasks: Task[]
  syncedAt: string | null
}

const CONNECTION_KEY = "task-rank:tw-connection:v1"
const WORKSPACE_KEY = "task-rank:workspace:v1"
const REVIEWS_KEY = "task-rank:reviews:v1"
const USER_KEY = "task-rank:user:v1"
const SESSION_KEY = "task-rank:session:v1"
const GOOGLE_TOKEN_KEY = "task-rank:google-token:v1"

export const DEMO_WORKSPACE: Workspace = {
  source: "demo",
  people: DEMO_PEOPLE,
  projects: DEMO_PROJECTS,
  tasks: DEMO_TASKS,
  syncedAt: null,
}

export const EMPTY_TEAMWORK_WORKSPACE: Workspace = {
  source: "teamwork",
  people: [],
  projects: [],
  tasks: [],
  syncedAt: null,
}

function isPerson(value: unknown): value is Person {
  if (!value || typeof value !== "object") return false
  const person = value as Person
  return typeof person.id === "string" && typeof person.name === "string" && (person.role === "PM" || person.role === "Dev")
}

function isProject(value: unknown): value is Project {
  if (!value || typeof value !== "object") return false
  const project = value as Project
  return typeof project.id === "string" && typeof project.name === "string" && typeof project.color === "string"
}

function isTask(value: unknown): value is Task {
  if (!value || typeof value !== "object") return false
  const task = value as Task
  return (
    typeof task.id === "string" &&
    typeof task.title === "string" &&
    typeof task.summary === "string" &&
    typeof task.projectId === "string" &&
    typeof task.devId === "string" &&
    typeof task.pmId === "string" &&
    (task.status === "completed" || task.status === "in_progress") &&
    typeof task.startedAt === "string" &&
    (task.completedAt === null || typeof task.completedAt === "string")
  )
}

function isReview(value: unknown): value is Review {
  if (!value || typeof value !== "object") return false
  const review = value as Review
  return (
    typeof review.id === "string" &&
    typeof review.taskId === "string" &&
    (review.direction === "pm_to_dev" || review.direction === "dev_to_pm") &&
    typeof review.raterId === "string" &&
    typeof review.rateeId === "string" &&
    typeof review.detail === "string" &&
    typeof review.createdAt === "string" &&
    !!review.scores &&
    typeof review.scores === "object"
  )
}

function parseStoredConnection(raw: string | null): TeamworkConnection | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<TeamworkConnection>
    if (!parsed?.siteUrl) return null
    const authMode = parsed.authMode === "password" ? "password" : "apiKey"
    const connection: TeamworkConnection = {
      siteUrl: parsed.siteUrl,
      authMode,
      apiKey: parsed.apiKey ?? "",
      email: parsed.email ?? "",
      password: parsed.password ?? "",
      defaultPmId: parsed.defaultPmId ?? "",
    }
    return isUsableConnection(connection) ? connection : null
  } catch {
    return null
  }
}

export function loadConnection(): TeamworkConnection | null {
  const stored = parseStoredConnection(localStorage.getItem(CONNECTION_KEY))
  if (stored) return stored
  const fromEnv = envTeamworkConnection()
  if (fromEnv) {
    localStorage.setItem(CONNECTION_KEY, JSON.stringify(fromEnv))
    return fromEnv
  }
  return null
}

export function saveConnection(connection: TeamworkConnection | null) {
  if (!connection) {
    localStorage.removeItem(CONNECTION_KEY)
    return
  }
  if (!isUsableConnection(connection)) return
  localStorage.setItem(CONNECTION_KEY, JSON.stringify(connection))
}

export function loadWorkspace(): Workspace {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY)
    if (!raw) return EMPTY_TEAMWORK_WORKSPACE
    const parsed = JSON.parse(raw) as Workspace
    if (parsed.source === "demo") return DEMO_WORKSPACE
    if (
      parsed.source === "teamwork" &&
      Array.isArray(parsed.people) &&
      parsed.people.every(isPerson) &&
      Array.isArray(parsed.projects) &&
      parsed.projects.every(isProject) &&
      Array.isArray(parsed.tasks) &&
      parsed.tasks.every(isTask)
    ) {
      return {
        source: "teamwork",
        people: parsed.people,
        projects: parsed.projects,
        tasks: parsed.tasks,
        syncedAt: typeof parsed.syncedAt === "string" ? parsed.syncedAt : null,
      }
    }
    return EMPTY_TEAMWORK_WORKSPACE
  } catch {
    return EMPTY_TEAMWORK_WORKSPACE
  }
}

export function saveWorkspace(workspace: Workspace) {
  if (workspace.source === "demo") {
    localStorage.removeItem(WORKSPACE_KEY)
    return
  }
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace))
}

export function loadReviews(source: DataSource): Review[] {
  try {
    const raw = localStorage.getItem(REVIEWS_KEY)
    if (!raw) return source === "demo" ? SEED_REVIEWS : []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.every(isReview)) return source === "demo" ? SEED_REVIEWS : []
    return parsed
  } catch {
    return source === "demo" ? SEED_REVIEWS : []
  }
}

export function saveReviews(reviews: Review[]) {
  localStorage.setItem(REVIEWS_KEY, JSON.stringify(reviews))
}

export function clearReviews() {
  localStorage.removeItem(REVIEWS_KEY)
}

export function loadUserId(people: Person[]): string {
  const stored = localStorage.getItem(USER_KEY)
  if (stored && people.some((person) => person.id === stored)) return stored
  return people[0]?.id ?? ""
}

export function saveUserId(userId: string) {
  localStorage.setItem(USER_KEY, userId)
}

export function findPersonIdByEmail(people: Person[], email: string): string {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return ""
  return people.find((person) => (person.email ?? "").trim().toLowerCase() === normalized)?.id ?? ""
}

export function bindSessionToPeople(session: TeamworkSession, people: Person[]): TeamworkSession {
  const matchedId = findPersonIdByEmail(people, session.email)
  if (matchedId) return { ...session, personId: matchedId, isSuperUser: isSuperUserEmail(session.email) }
  if (session.provider === "teamwork" && session.personId) {
    return { ...session, isSuperUser: isSuperUserEmail(session.email) }
  }
  return { ...session, personId: matchedId, isSuperUser: isSuperUserEmail(session.email) }
}

export function loadSession(): TeamworkSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<TeamworkSession>
    const email = typeof parsed.email === "string" ? parsed.email : ""
    if (!email) return null
    return {
      provider: parsed.provider === "teamwork" ? "teamwork" : "google",
      personId: typeof parsed.personId === "string" ? parsed.personId : "",
      email,
      name: typeof parsed.name === "string" ? parsed.name : "",
      picture: typeof parsed.picture === "string" ? parsed.picture : undefined,
      isSuperUser: isSuperUserEmail(email),
      googleCredential: sessionStorage.getItem(GOOGLE_TOKEN_KEY) || undefined,
    }
  } catch {
    return null
  }
}

export function saveSession(session: TeamworkSession | null) {
  if (!session) {
    localStorage.removeItem(SESSION_KEY)
    sessionStorage.removeItem(GOOGLE_TOKEN_KEY)
    return
  }
  const { googleCredential, ...stored } = session
  localStorage.setItem(SESSION_KEY, JSON.stringify(stored))
  if (googleCredential) sessionStorage.setItem(GOOGLE_TOKEN_KEY, googleCredential)
  else sessionStorage.removeItem(GOOGLE_TOKEN_KEY)
}

export function sessionFromMe(me: { id: string; email: string; name: string }): TeamworkSession {
  return {
    provider: "teamwork",
    personId: me.id,
    email: me.email,
    name: me.name,
    isSuperUser: isSuperUserEmail(me.email),
  }
}

export function sessionFromGoogle(
  profile: { email: string; name: string; picture?: string },
  people: Person[],
  credential?: string,
): TeamworkSession {
  const email = profile.email.trim()
  return {
    provider: "google",
    personId: findPersonIdByEmail(people, email),
    email,
    name: profile.name.trim() || email,
    picture: profile.picture,
    isSuperUser: isSuperUserEmail(email),
    ...(credential ? { googleCredential: credential } : {}),
  }
}

/** Ensure the logged-in user exists in the workspace people list. */
export function ensureSessionPerson(people: Person[], session: TeamworkSession | null): Person[] {
  if (!session?.personId) return people
  if (people.some((person) => person.id === session.personId)) return people
  return [
    ...people,
    {
      id: session.personId,
      name: session.name || session.email || `User ${session.personId}`,
      role: "Dev",
      ...(session.email ? { email: session.email.trim().toLowerCase() } : {}),
    },
  ]
}

export function personFrom(workspace: Workspace, id: string): Person {
  const found = workspace.people.find((person) => person.id === id)
  if (!found) throw new Error(`Unknown person: ${id}`)
  return found
}

export function projectFrom(workspace: Workspace, id: string): Project {
  const found = workspace.projects.find((project) => project.id === id)
  if (!found) throw new Error(`Unknown project: ${id}`)
  return found
}

export function taskFrom(workspace: Workspace, id: string): Task {
  const found = workspace.tasks.find((task) => task.id === id)
  if (!found) throw new Error(`Unknown task: ${id}`)
  return found
}

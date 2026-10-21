import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { SEED_REVIEWS } from "./data"
import {
  DEMO_WORKSPACE,
  EMPTY_TEAMWORK_WORKSPACE,
  bindSessionToPeople,
  ensureSessionPerson,
  loadConnection,
  loadReviews,
  loadSession,
  loadUserId,
  loadWorkspace,
  projectFrom,
  saveConnection,
  saveReviews,
  saveSession,
  saveUserId,
  saveWorkspace,
  type Workspace,
} from "./workspace"
import { signOutGoogle } from "./auth/google"
import { fetchReviews, upsertReviews } from "./reviews/client"
import type { Person, Project, Review, Task } from "./types"
import type { TeamworkConnection, TeamworkSession } from "./teamwork/types"
import { isUsableConnection } from "./teamwork/config"
import { syncTeamworkWorkspace } from "./teamwork/sync"

type WorkspaceContextValue = {
  workspace: Workspace
  connection: TeamworkConnection | null
  session: TeamworkSession | null
  reviews: Review[]
  userId: string
  /** true if the current user can switch person (demo or superuser). */
  canImpersonate: boolean
  people: Person[]
  projects: Project[]
  tasks: Task[]
  personById: (id: string) => Person
  projectById: (id: string) => Project
  taskById: (id: string) => Task
  setUserId: (userId: string) => void
  setReviews: (updater: Review[] | ((current: Review[]) => Review[])) => void
  useDemo: () => void
      setConnection: (connection: TeamworkConnection | null) => void
  setSession: (session: TeamworkSession | null) => void
  signOut: () => void
  syncing: boolean
  syncError: string | null
  ratingsError: string | null
  applyTeamworkWorkspace: (workspace: Omit<Workspace, "source"> & { syncedAt: string }, session?: TeamworkSession | null) => void
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

function visibleTasksFor(workspace: Workspace, session: TeamworkSession | null): Task[] {
  if (workspace.source !== "teamwork" || !session || session.isSuperUser) return workspace.tasks
  if (!session.personId) return []
  return workspace.tasks.filter((task) => task.devId === session.personId || task.pmId === session.personId)
}

function visiblePeopleFor(workspace: Workspace, session: TeamworkSession | null): Person[] {
  const people = ensureSessionPerson(workspace.people, session)
  if (workspace.source !== "teamwork" || !session || session.isSuperUser) return people
  if (!session.personId) return []
  // Regular user: only their own record (Satisfaction does not list others).
  return people.filter((person) => person.id === session.personId)
}

function counterpartPeople(workspace: Workspace, session: TeamworkSession | null, tasks: Task[]): Person[] {
  const people = ensureSessionPerson(workspace.people, session)
  if (workspace.source !== "teamwork" || !session || session.isSuperUser) return people
  const ids = new Set(tasks.flatMap((task) => [task.devId, task.pmId]))
  ids.add(session.personId)
  return people.filter((person) => ids.has(person.id))
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace>(loadWorkspace)
  const [connection, setConnectionState] = useState<TeamworkConnection | null>(loadConnection)
  const [session, setSessionState] = useState<TeamworkSession | null>(() => {
    const raw = loadSession()
    if (!raw) return null
    return bindSessionToPeople(raw, loadWorkspace().people)
  })
  const [reviews, setReviewsState] = useState<Review[]>(() => loadReviews(loadWorkspace().source))
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [ratingsError, setRatingsError] = useState<string | null>(null)
  const autoSyncedFor = useRef("")
  const importedRatingsFor = useRef("")
  const [userId, setUserIdState] = useState(() => {
    const ws = loadWorkspace()
    const raw = loadSession()
    const sess = raw ? bindSessionToPeople(raw, ws.people) : null
    if (ws.source === "teamwork" && sess && !sess.isSuperUser) return sess.personId || ""
    return loadUserId(ensureSessionPerson(ws.people, sess))
  })

  const value = useMemo<WorkspaceContextValue>(() => {
    const boundSession = session && workspace.source === "teamwork" ? bindSessionToPeople(session, workspace.people) : session
    const tasks = visibleTasksFor(workspace, boundSession)
    const canImpersonate = Boolean(boundSession?.isSuperUser)
    // Satisfaction lists: only self unless superuser. Lookups (names on tasks) use workspace people.
    const people = canImpersonate
      ? ensureSessionPerson(workspace.people, boundSession)
      : visiblePeopleFor(workspace, boundSession)
    const lookupPeople = counterpartPeople(workspace, boundSession, workspace.tasks)
    const projects = workspace.projects.filter((project) => tasks.some((task) => task.projectId === project.id))

    return {
      workspace,
      connection,
      session: boundSession,
      reviews,
      userId,
      canImpersonate,
      people,
      projects,
      tasks,
      personById: (id) => {
        const found = lookupPeople.find((person) => person.id === id) ?? workspace.people.find((person) => person.id === id)
        if (!found) throw new Error(`Unknown person: ${id}`)
        return found
      },
      projectById: (id) => projectFrom(workspace, id),
      taskById: (id) => {
        const found = workspace.tasks.find((task) => task.id === id)
        if (!found) throw new Error(`Unknown task: ${id}`)
        if (boundSession && !boundSession.isSuperUser && workspace.source === "teamwork") {
          if (!boundSession.personId || (found.devId !== boundSession.personId && found.pmId !== boundSession.personId)) {
            throw new Error(`Unknown task: ${id}`)
          }
        }
        return found
      },
      setUserId: (next) => {
        if (workspace.source === "teamwork" && boundSession && !boundSession.isSuperUser) {
          setUserIdState(boundSession.personId)
          saveUserId(boundSession.personId)
          return
        }
        setUserIdState(next)
        saveUserId(next)
      },
      setReviews: (updater) => {
        setReviewsState((current) => {
          const next = typeof updater === "function" ? updater(current) : updater
          saveReviews(next)
          return next
        })
      },
      useDemo: () => {
        setWorkspace(DEMO_WORKSPACE)
        saveWorkspace(DEMO_WORKSPACE)
        const demoSession: TeamworkSession = {
          provider: "teamwork",
          personId: DEMO_WORKSPACE.people[0]?.id ?? "",
          email: "demo@taskrank.local",
          name: "Demo",
          isSuperUser: true,
        }
        setSessionState(demoSession)
        saveSession(demoSession)
        setReviewsState(SEED_REVIEWS)
        saveReviews(SEED_REVIEWS)
        const nextUser = DEMO_WORKSPACE.people[0]?.id ?? ""
        setUserIdState(nextUser)
        saveUserId(nextUser)
      },
      setConnection: (next) => {
        setConnectionState(next)
        saveConnection(next)
      },
      syncing,
      syncError,
      ratingsError,
      setSession: (next) => {
        const bound = next ? bindSessionToPeople(next, workspace.people) : null
        setSessionState(bound)
        saveSession(bound)
        if (bound && workspace.source === "demo") {
          setWorkspace(EMPTY_TEAMWORK_WORKSPACE)
          saveWorkspace(EMPTY_TEAMWORK_WORKSPACE)
          if (bound.email !== "demo@taskrank.local") {
            setReviewsState([])
            saveReviews([])
          }
        }
        if (bound && !bound.isSuperUser) {
          setUserIdState(bound.personId)
          saveUserId(bound.personId)
        } else if (bound?.isSuperUser && bound.personId) {
          setUserIdState(bound.personId)
          saveUserId(bound.personId)
        }
      },
      signOut: () => {
        signOutGoogle(session?.email)
        setSessionState(null)
        saveSession(null)
      },
      applyTeamworkWorkspace: (snapshot, nextSession) => {
        const merged = nextSession === undefined ? session : nextSession
        const sess = merged
          ? bindSessionToPeople(
              {
                ...merged,
                googleCredential: merged.googleCredential ?? session?.googleCredential,
              },
              snapshot.people,
            )
          : null
        const people = ensureSessionPerson(snapshot.people, sess)
        const next: Workspace = { source: "teamwork", ...snapshot, people }
        setWorkspace(next)
        saveWorkspace(next)
        if (sess) {
          setSessionState(sess)
          saveSession(sess)
        }
        setUserIdState((current) => {
          if (sess && !sess.isSuperUser) {
            saveUserId(sess.personId)
            return sess.personId
          }
          const nextUser = people.some((person) => person.id === current)
            ? current
            : sess?.personId && people.some((person) => person.id === sess.personId)
              ? sess.personId
              : (people[0]?.id ?? "")
          saveUserId(nextUser)
          return nextUser
        })
      },
    }
  }, [workspace, connection, session, reviews, userId, syncing, syncError, ratingsError])

  useEffect(() => {
    if (!session || session.email === "demo@taskrank.local") return
    if (!isUsableConnection(connection)) return
    const key = `${session.email}:${connection.siteUrl}:${connection.apiKey || connection.email}`
    if (autoSyncedFor.current === key) return
    autoSyncedFor.current = key

    let cancelled = false
    setSyncing(true)
    setSyncError(null)
    syncTeamworkWorkspace(connection, session)
      .then((result) => {
        if (cancelled) return
        const syncedAt = new Date().toISOString()
        const sess = result.session
          ? bindSessionToPeople(
              { ...session, ...result.session, googleCredential: session.googleCredential },
              result.people,
            )
          : session
        const people = ensureSessionPerson(result.people, sess)
        const next: Workspace = { source: "teamwork", people, projects: result.projects, tasks: result.tasks, syncedAt }
        setWorkspace(next)
        saveWorkspace(next)
        saveConnection(connection)
        if (sess) {
          setSessionState(sess)
          saveSession(sess)
          if (!sess.isSuperUser) {
            setUserIdState(sess.personId)
            saveUserId(sess.personId)
          }
        }
      })
      .catch((error) => {
        if (!cancelled) {
          autoSyncedFor.current = ""
          setSyncError(error instanceof Error ? error.message : "Could not sync Teamwork.")
        }
      })
      .finally(() => {
        if (!cancelled) setSyncing(false)
      })

    return () => {
      cancelled = true
    }
  }, [connection, session])

  useEffect(() => {
    if (workspace.source !== "teamwork") {
      setRatingsError(null)
      return
    }
    const credential = session?.googleCredential
    if (!credential || !session) return

    let cancelled = false
    setRatingsError(null)
    fetchReviews(credential)
      .then(async (remote) => {
        if (cancelled) return
        const local = loadReviews("teamwork")
        const missing = local.filter(
          (review) => !remote.some((item) => item.taskId === review.taskId && item.direction === review.direction),
        )
        const importKey = `${session.email}:${missing.length}`
        let next = remote
        if (missing.length > 0 && importedRatingsFor.current !== importKey) {
          importedRatingsFor.current = importKey
          const people = workspace.people
          const imported = await upsertReviews(
            credential,
            missing.map((review) => ({
              ...review,
              raterEmail: people.find((person) => person.id === review.raterId)?.email,
              rateeEmail: people.find((person) => person.id === review.rateeId)?.email,
            })),
          )
          next = [
            ...remote,
            ...imported.filter(
              (review) => !remote.some((item) => item.taskId === review.taskId && item.direction === review.direction),
            ),
          ]
        }
        setReviewsState(next)
        saveReviews(next)
      })
      .catch((error) => {
        if (!cancelled) setRatingsError(error instanceof Error ? error.message : "Could not load saved ratings.")
      })

    return () => {
      cancelled = true
    }
  }, [session, workspace.source, workspace.people])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error("useWorkspace must be used within WorkspaceProvider")
  return value
}

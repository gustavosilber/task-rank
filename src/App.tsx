import { useEffect, useState } from "react"
import { upsertReviews } from "./reviews/client"
import type { Period, Review, SaveReviewResult } from "./types"
import { ConnectionView } from "./views/ConnectionView"
import { LoginView } from "./views/LoginView"
import { SatisfactionView } from "./views/SatisfactionView"
import { TaskDetail } from "./views/TaskDetail"
import { TasksView } from "./views/TasksView"
import { useWorkspace } from "./WorkspaceContext"
import { clearReviews, DEMO_WORKSPACE, loadReviews } from "./workspace"

type PeopleScreen = { name: "people"; personId: string; period: Period }
type Screen = { name: "tasks" } | PeopleScreen | { name: "teamwork" }
type Route = Screen | { name: "task"; taskId: string; back: Exclude<Screen, { name: "teamwork" }> }

function sectionOf(route: Route): Screen["name"] {
  return route.name === "task" ? route.back.name : route.name
}

function AppShell() {
  const {
    people,
    reviews,
    userId,
    setUserId,
    setReviews,
    taskById,
    workspace,
    useDemo,
    canImpersonate,
    session,
    personById,
    signOut,
    syncing,
    syncError,
    ratingsError,
  } = useWorkspace()
  const [peopleRoute, setPeopleRoute] = useState<PeopleScreen>({
    name: "people",
    personId: people[0]?.id ?? "",
    period: "90",
  })
  const [route, setRoute] = useState<Route>(() =>
    workspace.source === "teamwork" && !workspace.syncedAt ? { name: "teamwork" } : { name: "tasks" },
  )

  useEffect(() => {
    if (!canImpersonate && session?.personId) {
      if (peopleRoute.personId !== session.personId) {
        setPeopleRoute((current) => ({ ...current, personId: session.personId }))
      }
      return
    }
    if (!people.some((person) => person.id === peopleRoute.personId) && people[0]) {
      setPeopleRoute((current) => ({ ...current, personId: people[0].id }))
    }
  }, [people, peopleRoute.personId, canImpersonate, session?.personId])

  useEffect(() => {
    if (!session) return
    if (route.name === "task") {
      try {
        const task = taskById(route.taskId)
        document.title = `${task.title} · Task Rank`
      } catch {
        setRoute(route.back)
      }
      return
    }
    document.title =
      route.name === "people" ? "Satisfaction · Task Rank" : route.name === "teamwork" ? "Teamwork · Task Rank" : "Tasks · Task Rank"
  }, [route, taskById, session])

  function goPeople(next: PeopleScreen) {
    const personId = !canImpersonate && session?.personId ? session.personId : next.personId
    const locked = { ...next, personId }
    setPeopleRoute(locked)
    setRoute(locked)
  }

  function openTask(taskId: string, back: Exclude<Screen, { name: "teamwork" }>) {
    setRoute({ name: "task", taskId, back })
  }

  async function saveReview(review: Review): Promise<SaveReviewResult> {
    const apply = (saved: Review) => {
      setReviews((current) => [
        ...current.filter(
          (item) =>
            item.id !== saved.id &&
            !(item.taskId === saved.taskId && item.direction === saved.direction && item.raterId === saved.raterId && item.rateeId === saved.rateeId),
        ),
        saved,
      ])
    }

    if (workspace.source === "teamwork" && session?.googleCredential) {
      try {
        let raterEmail: string | undefined
        let rateeEmail: string | undefined
        try {
          raterEmail = personById(review.raterId).email
        } catch {
          raterEmail = session.email
        }
        try {
          rateeEmail = personById(review.rateeId).email
        } catch {
          rateeEmail = undefined
        }
        const [saved] = await upsertReviews(session.googleCredential, [{ ...review, raterEmail, rateeEmail }])
        apply(saved ?? review)
        return { published: true }
      } catch (error) {
        apply(review)
        return {
          published: false,
          publishError: error instanceof Error ? error.message : "Could not save to the database.",
        }
      }
    }

    apply(review)
    return { published: workspace.source !== "teamwork" }
  }

  function resetDemo() {
    if (!window.confirm("This clears the demo reviews and restores the sample data.")) return
    clearReviews()
    useDemo()
    setReviews(loadReviews("demo"))
    setRoute({ name: "tasks" })
    setPeopleRoute({ name: "people", personId: DEMO_WORKSPACE.people[0].id, period: "90" })
  }

  if (!session) return <LoginView />

  const section = sectionOf(route)
  const sessionLabel = session
    ? session.name || session.email
    : userId
      ? (() => {
          try {
            return personById(userId).name
          } catch {
            return "—"
          }
        })()
      : "—"

  return (
    <div className="app">
      <header className="topbar">
        <div className="wrap bar">
          <div className="brand">
            <strong>Task Rank</strong>
            <span>{syncing ? "Syncing Teamwork…" : workspace.source === "teamwork" ? "Teamwork" : "Proof of concept"}</span>
          </div>
          <nav className="nav" aria-label="Sections">
            <button type="button" className={section === "tasks" ? "on" : ""} aria-current={section === "tasks" ? "page" : undefined} onClick={() => setRoute({ name: "tasks" })}>
              Tasks
            </button>
            <button
              type="button"
              className={section === "people" ? "on" : ""}
              aria-current={section === "people" ? "page" : undefined}
              onClick={() => goPeople({ ...peopleRoute, personId: people.some((person) => person.id === peopleRoute.personId) ? peopleRoute.personId : (people[0]?.id ?? "") })}
            >
              Satisfaction
            </button>
            <button
              type="button"
              className={section === "teamwork" ? "on" : ""}
              aria-current={section === "teamwork" ? "page" : undefined}
              onClick={() => setRoute({ name: "teamwork" })}
            >
              Teamwork
            </button>
          </nav>
          <div className="bar-end">
            {canImpersonate ? (
              <label className="user">
                <span>Act as</span>
                <select
                  value={userId}
                  onChange={(event) => {
                    setUserId(event.target.value)
                  }}
                >
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name} · {person.role}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="user">
                <span>{session?.provider === "google" ? "Google" : "Session"}</span>
                <strong className="session-name">{sessionLabel}</strong>
              </div>
            )}
            {workspace.source === "demo" ? (
              <button type="button" className="ghost" onClick={resetDemo}>
                Reset demo
              </button>
            ) : (
              <button type="button" className="ghost" onClick={() => setRoute({ name: "teamwork" })}>
                Sync
              </button>
            )}
            <button type="button" className="ghost" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="wrap">
        {syncError && <p className="error-line">{syncError}</p>}
        {ratingsError && <p className="error-line">{ratingsError}</p>}
        {syncing && workspace.tasks.length === 0 && (
          <p className="lede">Syncing active tasks from Teamwork. This can take a moment.</p>
        )}
        {route.name === "tasks" && (
          <TasksView
            reviews={reviews}
            onOpenTask={(taskId) => openTask(taskId, { name: "tasks" })}
            onOpenPerson={(personId) => goPeople({ name: "people", personId, period: peopleRoute.period })}
          />
        )}
        {route.name === "people" && peopleRoute.personId && (
          <SatisfactionView
            personId={route.personId}
            period={route.period}
            reviews={reviews}
            onPerson={(personId) => goPeople({ name: "people", personId, period: route.period })}
            onPeriod={(period) => goPeople({ name: "people", personId: route.personId, period })}
            onOpenTask={(taskId) => openTask(taskId, route)}
          />
        )}
        {route.name === "teamwork" && <ConnectionView />}
        {route.name === "task" && (
          <TaskDetail
            taskId={route.taskId}
            reviews={reviews}
            userId={userId}
            backLabel={route.back.name === "tasks" ? "Back to tasks" : "Back to satisfaction"}
            onBack={() => setRoute(route.back)}
            onSave={saveReview}
          />
        )}
      </main>
    </div>
  )
}

export function App() {
  return <AppShell />
}

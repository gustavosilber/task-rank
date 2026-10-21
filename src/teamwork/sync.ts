import {
  fetchPeople,
  fetchProjects,
  fetchTasklists,
  fetchTasks,
  fetchTasksByProject,
  tasklistProjectMap,
  testConnection,
} from "./client"
import { mapWorkspace } from "./map"
import type { TeamworkConnection } from "./types"
import type { Person, Project, Task } from "../types"
import { bindSessionToPeople, sessionFromMe } from "../workspace"
import type { TeamworkSession } from "./types"

export type SyncResult = {
  people: Person[]
  projects: Project[]
  tasks: Task[]
  session: TeamworkSession | null
  message: string
}

export async function syncTeamworkWorkspace(
  connection: TeamworkConnection,
  currentSession: TeamworkSession | null,
): Promise<SyncResult> {
  const [rawPeople, activeProjects] = await Promise.all([fetchPeople(connection), fetchProjects(connection)])
  if (activeProjects.length === 0) {
    throw new Error("There are no active projects in Teamwork.")
  }

  const byProject = await fetchTasksByProject(connection, activeProjects)
  let tasks = byProject.tasks
  let tasklists = 0
  let tasklistToProject = new Map<string, string>()

  if (tasks.length === 0) {
    const [taskBundle, lists] = await Promise.all([fetchTasks(connection), fetchTasklists(connection)])
    tasklistToProject = tasklistProjectMap(lists)
    tasklists = tasklistToProject.size
    tasks = taskBundle.tasks
    byProject.people.push(...taskBundle.people)
  }

  const mapped = mapWorkspace([...rawPeople, ...byProject.people], activeProjects, tasks, connection.defaultPmId, tasklistToProject)
  mapped.diagnostics.tasklists = tasklists || mapped.diagnostics.tasklists

  let nextSession = currentSession
  if (!nextSession || nextSession.provider !== "google") {
    const probe = await testConnection(connection)
    nextSession = sessionFromMe(probe.me)
  } else {
    nextSession = bindSessionToPeople(nextSession, mapped.people)
  }

  const d = mapped.diagnostics
  const scopeNote = nextSession.isSuperUser
    ? "full access"
    : nextSession.personId
      ? "only your tasks as Dev or PM"
      : `email ${nextSession.email} has no match in Teamwork`

  if (d.mappedTasks === 0) {
    throw new Error(
      `Found ${activeProjects.length} active projects and ${d.rawTasks} tasks, but none were usable` +
        ` (no project: ${d.droppedNoProject}, no assignee/creator: ${d.droppedNoDev}, outside active: ${d.droppedUnknownProject}` +
        `${d.sampleTaskKeys.length ? `; task keys: ${d.sampleTaskKeys.slice(0, 12).join(", ")}` : ""}).`,
    )
  }

  return {
    people: mapped.people,
    projects: mapped.projects,
    tasks: mapped.tasks,
    session: nextSession,
    message: `Synced ${d.mappedTasks} tasks from ${d.mappedProjects} active projects (${d.mappedPeople} people; ${scopeNote}). Ratings are saved in the app only.`,
  }
}

import type { Person, Project, Role, Task } from "../types"
import type { SyncDiagnostics, TwPerson, TwProject, TwTask } from "./types"

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

/** Users assigned to the task in Teamwork (People responsible / assignees). */
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

export function mapPeople(raw: TwPerson[]): Person[] {
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

export function mapProjects(raw: TwProject[]): Project[] {
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

export function mapWorkspace(
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

export function refineRoles(people: Person[], tasks: Task[]): Person[] {
  const asDev = new Set(tasks.flatMap((task) => (task.devIds?.length ? task.devIds : [task.devId])))
  const asPm = new Set(tasks.flatMap((task) => (task.pmIds?.length ? task.pmIds : [task.pmId])))
  return people.map((person) => {
    const mostlyPm = asPm.has(person.id) && !asDev.has(person.id)
    if (mostlyPm || person.role === "PM") return { ...person, role: mostlyPm ? "PM" : person.role }
    return { ...person, role: "Dev" }
  })
}

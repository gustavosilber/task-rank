import { useState } from "react"
import { formatDate, meanOfReviews, personHasUnratedWork, reviewsFor, taskDevIds, taskHasUnratedSlots, taskPmIds } from "../model"
import type { Review, Task } from "../types"
import { PeopleList, ProjectMark, ScoreValue, StatusBadge } from "../ui"
import { useWorkspace } from "../WorkspaceContext"

type StatusFilter = "all" | "in_progress" | "completed" | "unrated"

function compareTasks(a: Task, b: Task): number {
  if (a.status !== b.status) return a.status === "in_progress" ? -1 : 1
  return (b.completedAt ?? b.startedAt).localeCompare(a.completedAt ?? a.startedAt)
}

export function TasksView({
  reviews,
  onOpenTask,
  onOpenPerson,
}: {
  reviews: Review[]
  onOpenTask: (taskId: string) => void
  onOpenPerson: (personId: string) => void
}) {
  const { projects, tasks, workspace, canImpersonate, userId, syncing } = useWorkspace()
  const [projectId, setProjectId] = useState("all")
  const [status, setStatus] = useState<StatusFilter>("all")

  const inProject = tasks.filter((task) => projectId === "all" || task.projectId === projectId)
  const completed = inProject.filter((task) => task.status === "completed")
  const inProgress = inProject.filter((task) => task.status === "in_progress")
  const isUnrated = (task: Task) => (canImpersonate ? taskHasUnratedSlots(task, reviews) : personHasUnratedWork(task, userId, reviews))
  const unrated = inProject.filter(isUnrated)

  const visible = inProject
    .filter((task) => {
      if (status === "in_progress") return task.status === "in_progress"
      if (status === "completed") return task.status === "completed"
      if (status === "unrated") return isUnrated(task)
      return true
    })
    .sort(compareTasks)

  return (
    <section>
      <h1>Tasks</h1>
      <p className="lede">
        {syncing && tasks.length === 0
          ? "Syncing your Teamwork tasks…"
          : workspace.source === "teamwork"
            ? canImpersonate
              ? `${tasks.length} tasks synced from Teamwork. Satisfaction is the average of every PM → Dev review on the task.`
              : `Your ${tasks.length} assigned tasks. Each Dev and PM on a task can rate the others.`
            : `${tasks.length} tasks across ${projects.length} projects in one list. Satisfaction is the average of every PM → Dev review on the task.`}
      </p>

      <div className="stats">
        <button type="button" className={projectId === "all" && status === "all" ? "stat on" : "stat"} onClick={() => { setProjectId("all"); setStatus("all") }}>
          <strong>{projects.length}</strong>
          <span>Projects</span>
        </button>
        <button type="button" className={status === "in_progress" ? "stat on" : "stat"} onClick={() => setStatus("in_progress")}>
          <strong>{inProgress.length}</strong>
          <span>In progress</span>
        </button>
        <button type="button" className={status === "completed" ? "stat on" : "stat"} onClick={() => setStatus("completed")}>
          <strong>{completed.length}</strong>
          <span>Completed</span>
        </button>
        <button type="button" className={status === "unrated" ? "stat on" : "stat"} onClick={() => setStatus("unrated")}>
          <strong>{unrated.length}</strong>
          <span>Unrated</span>
        </button>
      </div>

      <div className="filters" role="group" aria-label="Project">
        <button type="button" className={projectId === "all" ? "filter on" : "filter"} aria-pressed={projectId === "all"} onClick={() => setProjectId("all")}>
          All projects
        </button>
        {projects.map((project) => (
          <button
            key={project.id}
            type="button"
            className={projectId === project.id ? "filter on" : "filter"}
            aria-pressed={projectId === project.id}
            onClick={() => setProjectId(project.id)}
          >
            <span className="dot" style={{ background: project.color }} />
            {project.name}
          </button>
        ))}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Project</th>
              <th>Devs</th>
              <th>PMs</th>
              <th>Status</th>
              <th>Closed</th>
              <th>Satisfaction</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((task) => {
              const score = meanOfReviews(reviewsFor(reviews, task.id, "pm_to_dev"))
              return (
                <tr key={task.id}>
                  <td>
                    <button type="button" className="link strong" onClick={() => onOpenTask(task.id)}>
                      {task.title}
                    </button>
                  </td>
                  <td>
                    <ProjectMark projectId={task.projectId} />
                  </td>
                  <td>
                    <PeopleList personIds={taskDevIds(task)} userId={userId} canImpersonate={canImpersonate} onOpen={onOpenPerson} />
                  </td>
                  <td>
                    <PeopleList personIds={taskPmIds(task)} userId={userId} canImpersonate={canImpersonate} onOpen={onOpenPerson} />
                  </td>
                  <td>
                    <StatusBadge status={task.status} />
                  </td>
                  <td>{task.completedAt ? formatDate(task.completedAt) : <span className="muted">Since {formatDate(task.startedAt)}</span>}</td>
                  <td>{score == null ? <span className="muted">No review</span> : <ScoreValue value={score} />}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {visible.length === 0 && (
          <p className="empty-row">
            {syncing
              ? "Syncing from Teamwork…"
              : workspace.source === "teamwork"
                ? "No tasks match this filter. Try syncing again in Teamwork."
                : "No tasks match this filter."}
          </p>
        )}
      </div>
      <p className="footnote">
        {visible.length} {visible.length === 1 ? "task" : "tasks"}
      </p>
    </section>
  )
}

import type { ReactNode } from "react"
import { DEV_ASPECTS, PM_ASPECTS, aspectsFor } from "../aspects"
import {
  aspectAverage,
  buildInsight,
  formatDate,
  formatScore,
  involvedReviews,
  isOnTask,
  meanOfReviews,
  periodBounds,
  personTasksInPeriod,
  referenceToday,
  reviewAverage,
  tone,
} from "../model"
import type { Aspect, Period, Project, Review, Task } from "../types"
import { ScoreValue } from "../ui"
import { useWorkspace } from "../WorkspaceContext"

const PERIODS: { id: Period; label: string }[] = [
  { id: "30", label: "Last 30 days" },
  { id: "90", label: "Last 90 days" },
  { id: "month", label: "This month" },
  { id: "year", label: "This year" },
]

function directionLabel(direction: Review["direction"]): string {
  return direction === "pm_to_dev" ? "PM → Dev" : "Dev → PM"
}

function periodLabel(period: Period): string {
  return PERIODS.find((item) => item.id === period)?.label ?? "This period"
}

function receivedOnTask(reviews: Review[], taskId: string, personId: string): Review[] {
  return reviews.filter((review) => review.taskId === taskId && review.rateeId === personId)
}

function ScoreCard({
  label,
  value,
  hint,
  active,
  onClick,
}: {
  label: ReactNode
  value: number | null
  hint: string
  active?: boolean
  onClick?: () => void
}) {
  const inner = (
    <>
      <span>{label}</span>
      <strong className={value == null ? "" : `tone-${tone(value)}`}>{value == null ? "—" : formatScore(value)}</strong>
      <em>{hint}</em>
    </>
  )
  if (!onClick) return <article className="card metric">{inner}</article>
  return (
    <button type="button" className={active ? "card metric score-card on" : "card metric score-card"} onClick={onClick} aria-pressed={active}>
      {inner}
    </button>
  )
}

export function SatisfactionView({
  personId,
  period,
  projectId,
  reviews,
  onPerson,
  onPeriod,
  onProject,
  onOpenTask,
}: {
  personId: string
  period: Period
  projectId: string
  reviews: Review[]
  onPerson: (personId: string) => void
  onPeriod: (period: Period) => void
  onProject: (projectId: string) => void
  onOpenTask: (taskId: string) => void
}) {
  const { people, projects, tasks: allTasks, personById, projectById, taskById, workspace, canImpersonate, userId, session } =
    useWorkspace()
  const lockedId = !canImpersonate ? session?.personId || userId : ""
  const effectiveId = lockedId || (people.some((person) => person.id === personId) ? personId : (people[0]?.id ?? personId))
  const person = personById(effectiveId)
  const bounds = periodBounds(period, referenceToday(workspace.source))
  const personProjects = projects.filter((project) => allTasks.some((task) => task.projectId === project.id && isOnTask(task, effectiveId)))
  const selectedProject = projectId !== "all" ? personProjects.find((project) => project.id === projectId) : undefined
  const effectiveProjectId = projectId !== "all" && !selectedProject ? "all" : projectId
  const periodTasks = personTasksInPeriod(allTasks, effectiveId, bounds.start, bounds.end)
  const tasks = effectiveProjectId === "all" ? periodTasks : periodTasks.filter((task) => task.projectId === effectiveProjectId)
  const involved = involvedReviews(reviews, tasks, effectiveId)
  const given = involved.filter((review) => review.raterId === effectiveId)
  const received = involved.filter((review) => review.rateeId === effectiveId)
  const ratedValue = meanOfReviews(received)
  const receivedPmToDev = received.filter((review) => review.direction === "pm_to_dev")
  const receivedDevToPm = received.filter((review) => review.direction === "dev_to_pm")
  const insightPool = receivedPmToDev.length >= receivedDevToPm.length ? receivedPmToDev : receivedDevToPm
  const insightBuilt = buildInsight(insightPool, aspectsFor(insightPool[0]?.direction ?? "pm_to_dev"))
  const sortedPeople = [...people].sort((a, b) => Number(a.role === "PM") - Number(b.role === "PM") || a.name.localeCompare(b.name, "en"))
  const contextBits = [periodLabel(period), selectedProject?.name ?? "All projects"]
  const contextHint = contextBits.join(" · ")
  const aspectGroups = [
    receivedPmToDev.length > 0 ? { label: "As Dev", aspects: DEV_ASPECTS, reviews: receivedPmToDev } : null,
    receivedDevToPm.length > 0 ? { label: "As PM", aspects: PM_ASPECTS, reviews: receivedDevToPm } : null,
  ].filter((group): group is { label: string; aspects: Aspect[]; reviews: Review[] } => group != null)

  function projectReceived(project: Project): Review[] {
    const ids = new Set(periodTasks.filter((task) => task.projectId === project.id).map((task) => task.id))
    return reviews.filter((review) => review.rateeId === effectiveId && ids.has(review.taskId))
  }

  return (
    <section>
      <h1>Satisfaction</h1>
      <p className="lede">
        {canImpersonate
          ? `How ${person.name} was rated in this period. Pick a project to slice the same average.`
          : "How you were rated in this period. Pick a project to slice the same average."}
      </p>

      {canImpersonate ? (
        <div className="people" role="group" aria-label="Person">
          {sortedPeople.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === effectiveId ? "chip on" : "chip"}
              aria-pressed={item.id === effectiveId}
              onClick={() => onPerson(item.id)}
            >
              {item.name}
              <small>{item.role}</small>
            </button>
          ))}
        </div>
      ) : (
        <div className="people">
          <span className="chip on" aria-current="true">
            {person.name}
            <small>{person.role}</small>
          </span>
        </div>
      )}

      <div className="filters" role="group" aria-label="Project">
        <button
          type="button"
          className={effectiveProjectId === "all" ? "filter on" : "filter"}
          aria-pressed={effectiveProjectId === "all"}
          onClick={() => onProject("all")}
        >
          All projects
        </button>
        {personProjects.map((project) => (
          <button
            key={project.id}
            type="button"
            className={effectiveProjectId === project.id ? "filter on" : "filter"}
            aria-pressed={effectiveProjectId === project.id}
            onClick={() => onProject(project.id)}
          >
            <span className="dot" style={{ background: project.color }} />
            {project.name}
          </button>
        ))}
      </div>

      <div className="period-row">
        <div className="segment" role="group" aria-label="Period">
          {PERIODS.map((item) => (
            <button key={item.id} type="button" className={item.id === period ? "on" : ""} aria-pressed={item.id === period} onClick={() => onPeriod(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <p className="range">
          From {formatDate(bounds.start)} to {formatDate(bounds.end)}
        </p>
      </div>

      <p className="context-line">Rated in {contextHint}</p>

      <div className="metrics">
        <ScoreCard
          label="Rated"
          value={ratedValue}
          hint={received.length === 0 ? "no ratings received yet" : `${received.length} ${received.length === 1 ? "review" : "reviews"} received`}
        />
        <article className="card metric">
          <span>Reviews</span>
          <strong>{received.length}</strong>
          <em>
            {given.length} given · {received.length} received
          </em>
        </article>
        <article className="card metric">
          <span>Tasks</span>
          <strong>{tasks.length}</strong>
          <em>{selectedProject ? selectedProject.name : `${personProjects.length} projects`}</em>
        </article>
      </div>

      {personProjects.length > 0 && (
        <>
          <h2>By project</h2>
          <div className="score-cards">
            {personProjects.map((project) => {
              const projectReviews = projectReceived(project)
              const taskCount = periodTasks.filter((task) => task.projectId === project.id).length
              return (
                <ScoreCard
                  key={project.id}
                  label={
                    <span className="project">
                      <span className="dot" style={{ background: project.color }} />
                      {project.name}
                    </span>
                  }
                  value={meanOfReviews(projectReviews)}
                  hint={
                    taskCount === 0
                      ? "no tasks in this period"
                      : `${projectReviews.length} received · ${taskCount} ${taskCount === 1 ? "task" : "tasks"}`
                  }
                  active={effectiveProjectId === project.id}
                  onClick={() => onProject(effectiveProjectId === project.id ? "all" : project.id)}
                />
              )
            })}
          </div>
        </>
      )}

      {aspectGroups.map((group) => (
        <div key={group.label}>
          <h2>{aspectGroups.length > 1 ? `${group.label} · aspects` : "Aspects"}</h2>
          <div className="score-cards">
            {group.aspects.map((aspect) => (
              <ScoreCard
                key={aspect.id}
                label={aspect.label}
                value={aspectAverage(group.reviews, aspect.id)}
                hint={`${group.reviews.length} ${group.reviews.length === 1 ? "review" : "reviews"}`}
              />
            ))}
          </div>
        </div>
      ))}

      {tasks.length === 0 ? (
        <div className="card empty">
          <h2>No tasks in this view</h2>
          <p>
            {person.name} has no tasks {selectedProject ? `in ${selectedProject.name} ` : ""}between {formatDate(bounds.start)} and {formatDate(bounds.end)}.
          </p>
        </div>
      ) : (
        <>
          <h2>Reviews in this view</h2>
          {involved.length === 0 ? (
            <div className="card empty">
              <p>There are no reviews on these tasks yet.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Direction</th>
                    <th>Role</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Average</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {involved.map((review) => {
                    const task = taskById(review.taskId)
                    const aspects = aspectsFor(review.direction)
                    const role = review.raterId === effectiveId ? "Gave" : "Received"
                    return (
                      <tr key={review.id}>
                        <td>
                          <button type="button" className="link strong" onClick={() => onOpenTask(task.id)}>
                            {task.title}
                          </button>
                          <div className="muted">{projectById(task.projectId).name}</div>
                        </td>
                        <td>{directionLabel(review.direction)}</td>
                        <td>{role}</td>
                        <td>{personById(review.raterId).name}</td>
                        <td>{personById(review.rateeId).name}</td>
                        <td>
                          <ScoreValue value={reviewAverage(review, aspects)} />
                        </td>
                        <td className="detail-cell">{review.detail}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <h2>Tasks in this view</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Project</th>
                  <th>Status</th>
                  <th>{canImpersonate ? "Received" : "You received"}</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task: Task) => {
                  const receivedHere = receivedOnTask(reviews, task.id, effectiveId)
                  return (
                    <tr key={task.id}>
                      <td>
                        <button type="button" className="link strong" onClick={() => onOpenTask(task.id)}>
                          {task.title}
                        </button>
                      </td>
                      <td>{projectById(task.projectId).name}</td>
                      <td>
                        {task.status === "completed"
                          ? task.completedAt
                            ? formatDate(task.completedAt)
                            : "Completed"
                          : `In progress · ${formatDate(task.startedAt)}`}
                      </td>
                      <td>
                        {receivedHere.length === 0 ? <span className="muted">—</span> : <ScoreValue value={meanOfReviews(receivedHere)} />}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {received.length > 0 && (
            <>
              <h2>Where to improve</h2>
              <div className="insight">
                {insightBuilt.kind === "few" && <p>Only a few received reviews so far. More scores will show which aspect repeats.</p>}
                {insightBuilt.kind === "even" && <p>In this view the aspects you were rated on were evenly balanced.</p>}
                {insightBuilt.kind === "gap" && (
                  <>
                    <p>
                      <strong>{insightBuilt.weakest.label}</strong> landed at {formatScore(insightBuilt.weakestAverage)}.{" "}
                      {insightBuilt.strongest.label}, the highest, landed at {formatScore(insightBuilt.strongestAverage)}.
                    </p>
                    {insightBuilt.mentions.slice(0, 3).map((mention, index) => {
                      const task = taskById(mention.taskId)
                      return (
                        <div key={`${mention.taskId}-${index}`} className="quote">
                          <button type="button" className="link strong" onClick={() => onOpenTask(task.id)}>
                            {task.title}
                          </button>
                          <span className="muted"> · {formatScore(mention.score)}</span>
                          <p>{mention.detail}</p>
                        </div>
                      )
                    })}
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}

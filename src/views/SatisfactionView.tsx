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

function reviewsOnTask(reviews: Review[], taskId: string, personId: string, side: "received" | "given"): Review[] {
  return reviews.filter(
    (review) => review.taskId === taskId && (side === "received" ? review.rateeId === personId : review.raterId === personId),
  )
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

function ReviewTable({
  reviews,
  empty,
  onOpenTask,
}: {
  reviews: Review[]
  empty: string
  onOpenTask: (taskId: string) => void
}) {
  const { personById, projectById, taskById } = useWorkspace()
  if (reviews.length === 0) {
    return (
      <div className="card empty">
        <p>{empty}</p>
      </div>
    )
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Task</th>
            <th>Direction</th>
            <th>From</th>
            <th>To</th>
            <th>Average</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {reviews.map((review) => {
            const task = taskById(review.taskId)
            return (
              <tr key={review.id}>
                <td>
                  <button type="button" className="link strong" onClick={() => onOpenTask(task.id)}>
                    {task.title}
                  </button>
                  <div className="muted">{projectById(task.projectId).name}</div>
                </td>
                <td>{directionLabel(review.direction)}</td>
                <td>{personById(review.raterId).name}</td>
                <td>{personById(review.rateeId).name}</td>
                <td>
                  <ScoreValue value={reviewAverage(review, aspectsFor(review.direction))} />
                </td>
                <td className="detail-cell">{review.detail}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function AspectCards({ label, groups }: { label: string; groups: { label: string; aspects: Aspect[]; reviews: Review[] }[] }) {
  if (groups.length === 0) return null
  return (
    <>
      {groups.map((group) => (
        <div key={`${label}-${group.label}`}>
          <h3 className="subhead">{groups.length > 1 ? `${label} · ${group.label}` : `${label} · aspects`}</h3>
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
    </>
  )
}

function aspectGroupsFor(reviews: Review[]): { label: string; aspects: Aspect[]; reviews: Review[] }[] {
  const asDev = reviews.filter((review) => review.direction === "pm_to_dev")
  const asPm = reviews.filter((review) => review.direction === "dev_to_pm")
  return [
    asDev.length > 0 ? { label: "As Dev", aspects: DEV_ASPECTS, reviews: asDev } : null,
    asPm.length > 0 ? { label: "As PM", aspects: PM_ASPECTS, reviews: asPm } : null,
  ].filter((group): group is { label: string; aspects: Aspect[]; reviews: Review[] } => group != null)
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
  const { people, projects, tasks: allTasks, personById, projectById, workspace, canImpersonate, userId, session } = useWorkspace()
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
  const receivedValue = meanOfReviews(received)
  const givenValue = meanOfReviews(given)
  const insightPool = received.filter((review) => review.direction === "pm_to_dev").length >= received.filter((review) => review.direction === "dev_to_pm").length
    ? received.filter((review) => review.direction === "pm_to_dev")
    : received.filter((review) => review.direction === "dev_to_pm")
  const insightBuilt = buildInsight(insightPool.length ? insightPool : received, aspectsFor((insightPool[0] ?? received[0])?.direction ?? "pm_to_dev"))
  const sortedPeople = [...people].sort((a, b) => Number(a.role === "PM") - Number(b.role === "PM") || a.name.localeCompare(b.name, "en"))
  const contextHint = `${periodLabel(period)} · ${selectedProject?.name ?? "All projects"}`
  const receivedAspects = aspectGroupsFor(received)
  const givenAspects = aspectGroupsFor(given)
  const you = canImpersonate ? person.name : "you"

  function projectSlice(project: Project, side: "received" | "given"): Review[] {
    const ids = new Set(periodTasks.filter((task) => task.projectId === project.id).map((task) => task.id))
    return reviews.filter(
      (review) => ids.has(review.taskId) && (side === "received" ? review.rateeId === effectiveId : review.raterId === effectiveId),
    )
  }

  return (
    <section>
      <h1>Satisfaction</h1>
      <p className="lede">
        {canImpersonate
          ? `How ${person.name} was rated, and how they rated others, in this period and project.`
          : "How you were rated, and how you rated others, in this period and project."}
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

      <p className="context-line">{contextHint}</p>

      <div className="metrics">
        <ScoreCard
          label="Received"
          value={receivedValue}
          hint={received.length === 0 ? "no ratings of you yet" : `${received.length} ${received.length === 1 ? "review" : "reviews"} of ${you}`}
        />
        <ScoreCard
          label="Given"
          value={givenValue}
          hint={given.length === 0 ? "no ratings left yet" : `${given.length} ${given.length === 1 ? "review" : "reviews"} left`}
        />
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
              const projectReceived = projectSlice(project, "received")
              const projectGiven = projectSlice(project, "given")
              const taskCount = periodTasks.filter((task) => task.projectId === project.id).length
              const receivedAvg = meanOfReviews(projectReceived)
              const givenAvg = meanOfReviews(projectGiven)
              return (
                <button
                  key={project.id}
                  type="button"
                  className={effectiveProjectId === project.id ? "card metric score-card on" : "card metric score-card"}
                  onClick={() => onProject(effectiveProjectId === project.id ? "all" : project.id)}
                  aria-pressed={effectiveProjectId === project.id}
                >
                  <span className="project">
                    <span className="dot" style={{ background: project.color }} />
                    {project.name}
                  </span>
                  <div className="score-pair">
                    <div>
                      <em>Received</em>
                      <strong className={receivedAvg == null ? "" : `tone-${tone(receivedAvg)}`}>
                        {receivedAvg == null ? "—" : formatScore(receivedAvg)}
                      </strong>
                    </div>
                    <div>
                      <em>Given</em>
                      <strong className={givenAvg == null ? "" : `tone-${tone(givenAvg)}`}>{givenAvg == null ? "—" : formatScore(givenAvg)}</strong>
                    </div>
                  </div>
                  <em>
                    {taskCount === 0
                      ? "no tasks in this period"
                      : `${projectReceived.length} received · ${projectGiven.length} given · ${taskCount} ${taskCount === 1 ? "task" : "tasks"}`}
                  </em>
                </button>
              )
            })}
          </div>
        </>
      )}

      <h2>Received</h2>
      <p className="lede">Ratings of {you} in this view.</p>
      <AspectCards label="Received" groups={receivedAspects} />
      <ReviewTable
        reviews={received}
        empty={canImpersonate ? `${person.name} has no received ratings in this view.` : "You have no received ratings in this view."}
        onOpenTask={onOpenTask}
      />

      <h2>Given</h2>
      <p className="lede">Ratings {canImpersonate ? `${person.name} left` : "you left"} in this view.</p>
      <AspectCards label="Given" groups={givenAspects} />
      <ReviewTable
        reviews={given}
        empty={canImpersonate ? `${person.name} has not left ratings in this view.` : "You have not left ratings in this view."}
        onOpenTask={onOpenTask}
      />

      {tasks.length === 0 ? (
        <div className="card empty">
          <h2>No tasks in this view</h2>
          <p>
            {person.name} has no tasks {selectedProject ? `in ${selectedProject.name} ` : ""}between {formatDate(bounds.start)} and {formatDate(bounds.end)}.
          </p>
        </div>
      ) : (
        <>
          <h2>Tasks in this view</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Project</th>
                  <th>Status</th>
                  <th>Received</th>
                  <th>Given</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task: Task) => {
                  const receivedHere = reviewsOnTask(reviews, task.id, effectiveId, "received")
                  const givenHere = reviewsOnTask(reviews, task.id, effectiveId, "given")
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
                      <td>
                        {givenHere.length === 0 ? <span className="muted">—</span> : <ScoreValue value={meanOfReviews(givenHere)} />}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {received.length > 0 && (
        <>
          <h2>Where to improve</h2>
          <div className="insight">
            {insightBuilt.kind === "few" && <p>Only a few received reviews so far. More scores will show which aspect repeats.</p>}
            {insightBuilt.kind === "even" && <p>In this view the aspects you were rated on were evenly balanced.</p>}
            {insightBuilt.kind === "gap" && (
              <>
                <p>
                  <strong>{insightBuilt.weakest.label}</strong> landed at {formatScore(insightBuilt.weakestAverage)}. {insightBuilt.strongest.label}, the
                  highest, landed at {formatScore(insightBuilt.strongestAverage)}.
                </p>
                {insightBuilt.mentions.slice(0, 3).map((mention, index) => {
                  const task = allTasks.find((item) => item.id === mention.taskId)
                  if (!task) return null
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
    </section>
  )
}

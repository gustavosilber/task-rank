import { aspectsFor } from "../aspects"
import {
  average,
  buildInsight,
  formatDate,
  formatScore,
  involvedReviews,
  periodBounds,
  personTasksInPeriod,
  referenceToday,
  meanOfReviews,
  reviewAverage,
  reviewMean,
  reviewsFor,
  tone,
} from "../model"
import type { Period, Review } from "../types"
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

export function SatisfactionView({
  personId,
  period,
  reviews,
  onPerson,
  onPeriod,
  onOpenTask,
}: {
  personId: string
  period: Period
  reviews: Review[]
  onPerson: (personId: string) => void
  onPeriod: (period: Period) => void
  onOpenTask: (taskId: string) => void
}) {
  const { people, tasks: allTasks, personById, projectById, taskById, workspace, canImpersonate, userId, session } =
    useWorkspace()
  const lockedId = !canImpersonate ? session?.personId || userId : ""
  const effectiveId = lockedId || (people.some((person) => person.id === personId) ? personId : (people[0]?.id ?? personId))
  const person = personById(effectiveId)
  const bounds = periodBounds(period, referenceToday(workspace.source))
  const tasks = personTasksInPeriod(allTasks, effectiveId, bounds.start, bounds.end)
  const involved = involvedReviews(reviews, tasks, effectiveId)
  const given = involved.filter((review) => review.raterId === effectiveId)
  const received = involved.filter((review) => review.rateeId === effectiveId)
  const satisfactionValue = average(
    involved.flatMap((review) => {
      const value = reviewMean(review)
      return value == null ? [] : [value]
    }),
  )
  // Insight only from received reviews of the most common direction (PM↔Dev aspects differ).
  const receivedPmToDev = received.filter((review) => review.direction === "pm_to_dev")
  const receivedDevToPm = received.filter((review) => review.direction === "dev_to_pm")
  const insightPool = receivedPmToDev.length >= receivedDevToPm.length ? receivedPmToDev : receivedDevToPm
  const insightBuilt = buildInsight(insightPool, aspectsFor(insightPool[0]?.direction ?? "pm_to_dev"))
  const sortedPeople = [...people].sort((a, b) => Number(a.role === "PM") - Number(b.role === "PM") || a.name.localeCompare(b.name, "en"))

  return (
    <section>
      <h1>Satisfaction</h1>
      <p className="lede">
        {canImpersonate
          ? "All reviews in the period where that person rated or was rated. A task with several Devs or PMs contributes every pair."
          : "Your reviews in the period: ones you gave and ones you received. A task with several Devs or PMs contributes every pair."}
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

      {tasks.length === 0 ? (
        <div className="card empty">
          <h2>No tasks in this period</h2>
          <p>
            {person.name} has no tasks (in progress or closed) between {formatDate(bounds.start)} and {formatDate(bounds.end)}.
          </p>
        </div>
      ) : (
        <>
          <div className="metrics">
            <article className="card metric">
              <span>Tasks</span>
              <strong>{tasks.length}</strong>
            </article>
            <article className="card metric">
              <span>Reviews</span>
              <strong>{involved.length}</strong>
              <em>
                {given.length} given · {received.length} received
              </em>
            </article>
            <article className="card metric">
              <span>Average</span>
              <strong className={satisfactionValue == null ? "" : `tone-${tone(satisfactionValue)}`}>
                {satisfactionValue == null ? "—" : formatScore(satisfactionValue)}
              </strong>
              <em>{satisfactionValue == null ? "no scores yet" : "across all reviews"}</em>
            </article>
          </div>

          <h2>Reviews in the period</h2>
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

          <h2>Tasks in the period</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Project</th>
                  <th>Status</th>
                  <th>PM → Dev</th>
                  <th>Dev → PM</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  const pmToDev = meanOfReviews(reviewsFor(reviews, task.id, "pm_to_dev"))
                  const devToPm = meanOfReviews(reviewsFor(reviews, task.id, "dev_to_pm"))
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
                        {pmToDev == null ? <span className="muted">—</span> : <ScoreValue value={pmToDev} />}
                      </td>
                      <td>
                        {devToPm == null ? <span className="muted">—</span> : <ScoreValue value={devToPm} />}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {received.length > 0 && (
            <>
              <h2>Where to improve (from reviews you received)</h2>
              <div className="insight">
                {insightBuilt.kind === "few" && <p>Only a few received reviews so far. More scores will show which aspect repeats.</p>}
                {insightBuilt.kind === "even" && <p>In this period the aspects you were rated on were evenly balanced.</p>}
                {insightBuilt.kind === "gap" && (
                  <>
                    <p>
                      <strong>{insightBuilt.weakest.label}</strong> landed at {formatScore(insightBuilt.weakestAverage)}.{" "}
                      {insightBuilt.strongest.label}, the highest, landed at {formatScore(insightBuilt.strongestAverage)}.
                    </p>
                    {insightBuilt.mentions.slice(0, 3).map((mention) => {
                      const task = taskById(mention.taskId)
                      return (
                        <div key={mention.taskId} className="quote">
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

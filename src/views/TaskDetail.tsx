import { useState } from "react"
import { aspectsFor } from "../aspects"
import { formatDate, iso, reviewAverage, reviewFor } from "../model"
import type { Aspect, AspectId, Direction, Review, SaveReviewResult, Scores } from "../types"
import { ProjectMark, ScoreValue, Stars, StatusBadge } from "../ui"
import { useWorkspace } from "../WorkspaceContext"

function completeScores(aspects: Aspect[], scores: Scores): Record<AspectId, number> | null {
  const next = {} as Record<AspectId, number>
  for (const aspect of aspects) {
    const value = scores[aspect.id]
    if (typeof value !== "number") return null
    next[aspect.id] = value
  }
  return next
}

function ReviewForm({
  direction,
  initialScores,
  initialDetail,
  submitLabel,
  pending,
  onSubmit,
}: {
  direction: Direction
  initialScores?: Scores
  initialDetail?: string
  submitLabel: string
  pending?: boolean
  onSubmit: (scores: Record<AspectId, number>, detail: string) => void
}) {
  const aspects = aspectsFor(direction)
  const [scores, setScores] = useState<Scores>(initialScores ?? {})
  const [detail, setDetail] = useState(initialDetail ?? "")
  const readyScores = completeScores(aspects, scores)
  const detailReady = detail.trim().length >= 8
  const hint = !readyScores ? "Pick a score for each aspect." : !detailReady ? "Describe in one sentence how the task went." : ""

  return (
    <form
      className="review-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (!readyScores || !detailReady || pending) return
        onSubmit(readyScores, detail.trim())
      }}
    >
      {aspects.map((aspect) => (
        <div key={aspect.id} className="aspect-line">
          <span>{aspect.label}</span>
          <Stars value={scores[aspect.id] ?? 0} onChange={(value) => setScores((current) => ({ ...current, [aspect.id]: value }))} />
        </div>
      ))}
      <label className="detail-label" htmlFor={`detail-${direction}`}>
        Detail
      </label>
      <textarea
        id={`detail-${direction}`}
        value={detail}
        onChange={(event) => setDetail(event.target.value)}
        placeholder={
          direction === "pm_to_dev"
            ? "What to repeat and what to change on the next task."
            : "How clear the scope, follow-up, and communication were."
        }
      />
      <div className="form-actions">
        {hint && (
          <p className="hint" id={`hint-${direction}`}>
            {hint}
          </p>
        )}
        <button type="submit" className="primary" disabled={!readyScores || !detailReady || pending} aria-describedby={hint ? `hint-${direction}` : undefined}>
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  )
}

function ReviewSlot({
  taskId,
  direction,
  userId,
  review,
  onSave,
}: {
  taskId: string
  direction: Direction
  userId: string
  review?: Review
  onSave: (review: Review) => Promise<SaveReviewResult | void> | SaveReviewResult | void
}) {
  const { personById, taskById } = useWorkspace()
  const task = taskById(taskId)
  const aspects = aspectsFor(direction)
  const raterId = direction === "pm_to_dev" ? task.pmId : task.devId
  const rateeId = direction === "pm_to_dev" ? task.devId : task.pmId
  const rater = personById(raterId)
  const ratee = personById(rateeId)
  const [editing, setEditing] = useState(false)
  const [saveStatus, setSaveStatus] = useState<"idle" | "local" | "saved">("idle")
  const [pending, setPending] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const canWrite = userId === raterId
  const title = direction === "pm_to_dev" ? "PM review" : "Dev review"
  const showForm = canWrite && (!review || editing)

  async function save(scores: Record<AspectId, number>, detail: string) {
    setPending(true)
    setSaveError(null)
    setSaveStatus("idle")
    try {
      const result = await onSave({
        id: `${task.id}:${direction}`,
        taskId: task.id,
        direction,
        raterId,
        rateeId,
        scores,
        detail,
        createdAt: iso(new Date()),
      })
      setEditing(false)
      if (result && "publishError" in result && result.publishError) setSaveError(result.publishError)
      setSaveStatus(result?.published ? "saved" : "local")
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save the review.")
    } finally {
      setPending(false)
    }
  }

  return (
    <article className="card">
      <div className="card-head">
        <div>
          <h3>{title}</h3>
          <p className="who">
            {rater.name} rates {ratee.name}
          </p>
        </div>
        {review && canWrite && !showForm && (
          <button type="button" className="ghost" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </div>

      {showForm ? (
        <ReviewForm
          direction={direction}
          initialScores={review?.scores}
          initialDetail={review?.detail}
          submitLabel={review ? "Save changes" : "Save review"}
          pending={pending}
          onSubmit={save}
        />
      ) : review ? (
        <>
          {aspects.map((aspect) => (
            <div key={aspect.id} className="aspect-line">
              <span>{aspect.label}</span>
              <span className="aspect-score">
                <Stars value={review.scores[aspect.id] ?? 0} />
                <ScoreValue value={review.scores[aspect.id] ?? null} />
              </span>
            </div>
          ))}
          <p className="detail">{review.detail}</p>
          <p className="meta-line">
            Average <ScoreValue value={reviewAverage(review, aspects)} /> · {formatDate(review.createdAt)}
          </p>
          {saveStatus === "saved" && <p className="saved">Saved.</p>}
          {saveStatus === "local" && <p className="saved">Saved on this browser only.</p>}
        </>
      ) : (
        <p className="who">{userId === raterId ? "You can leave this review." : `Only ${rater.name} can leave it.`}</p>
      )}
      {saveError && <p className="error-line">{saveError}</p>}
    </article>
  )
}

export function TaskDetail({
  taskId,
  reviews,
  userId,
  backLabel,
  onBack,
  onSave,
}: {
  taskId: string
  reviews: Review[]
  userId: string
  backLabel: string
  onBack: () => void
  onSave: (review: Review) => Promise<SaveReviewResult | void> | SaveReviewResult | void
}) {
  const { personById, taskById, workspace } = useWorkspace()
  const task = taskById(taskId)
  const dev = personById(task.devId)
  const pm = personById(task.pmId)

  return (
    <section>
      <button type="button" className="back" onClick={onBack}>
        {backLabel}
      </button>
      <div className="title-row">
        <h1>{task.title}</h1>
        <StatusBadge status={task.status} />
      </div>
      <p className="lede">{task.summary}</p>
      <dl className="meta">
        <div>
          <dt>Project</dt>
          <dd>
            <ProjectMark projectId={task.projectId} />
          </dd>
        </div>
        <div>
          <dt>Dev</dt>
          <dd>{dev.name}</dd>
        </div>
        <div>
          <dt>PM</dt>
          <dd>{pm.name}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{formatDate(task.startedAt)}</dd>
        </div>
        <div>
          <dt>Closed</dt>
          <dd>{task.completedAt ? formatDate(task.completedAt) : "In progress"}</dd>
        </div>
      </dl>

      <h2>Reviews</h2>
      <p className="lede">
        {workspace.source === "teamwork"
          ? "You can rate even while the task is still in progress. Ratings are saved in Task Rank, not in Teamwork."
          : "PM and Dev can rate each other at any time, including while the task is in progress."}
      </p>
      <div className="review-grid">
        <ReviewSlot taskId={task.id} direction="pm_to_dev" userId={userId} review={reviewFor(reviews, task.id, "pm_to_dev")} onSave={onSave} />
        <ReviewSlot taskId={task.id} direction="dev_to_pm" userId={userId} review={reviewFor(reviews, task.id, "dev_to_pm")} onSave={onSave} />
      </div>
    </section>
  )
}

import { useState } from "react"
import { formatScore, tone } from "./model"
import { useWorkspace } from "./WorkspaceContext"

function StarIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 1.8 12.4 7l5.6.5-4.2 3.6 1.3 5.5L10 13.8 4.9 16.6 6.2 11 2 7.5 7.6 7 10 1.8z" />
    </svg>
  )
}

export function Stars({ value, onChange }: { value: number; onChange?: (value: number) => void }) {
  const [hover, setHover] = useState(0)
  if (!onChange) {
    return (
      <span className="stars" aria-label={`${value} of 5`}>
        {[1, 2, 3, 4, 5].map((score) => (
          <span key={score} className={score <= value ? "star on" : "star"}>
            <StarIcon />
          </span>
        ))}
      </span>
    )
  }

  const active = hover || value
  return (
    <span className="stars" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((score) => (
        <button
          key={score}
          type="button"
          className={score <= active ? "star on" : "star"}
          aria-label={`${score} of 5`}
          aria-pressed={value === score}
          onMouseEnter={() => setHover(score)}
          onFocus={() => setHover(score)}
          onBlur={() => setHover(0)}
          onClick={() => onChange(score)}
        >
          <StarIcon />
        </button>
      ))}
    </span>
  )
}

export function ScoreValue({ value }: { value: number | null }) {
  if (value == null) return <span className="muted">—</span>
  return <span className={`score tone-${tone(value)}`}>{formatScore(value)}</span>
}

export function StatusBadge({ status }: { status: "in_progress" | "completed" }) {
  return <span className={`badge ${status}`}>{status === "completed" ? "Completed" : "In progress"}</span>
}

export function ProjectMark({ projectId }: { projectId: string }) {
  const { projectById } = useWorkspace()
  const project = projectById(projectId)
  return (
    <span className="project">
      <span className="dot" style={{ background: project.color }} />
      {project.name}
    </span>
  )
}

export function PersonButton({ personId, onOpen }: { personId: string; onOpen?: (personId: string) => void }) {
  const { personById } = useWorkspace()
  const person = personById(personId)
  if (!onOpen) return <span>{person.name}</span>
  return (
    <button type="button" className="link" onClick={() => onOpen(personId)}>
      {person.name}
    </button>
  )
}

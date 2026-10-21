export type Direction = "pm_to_dev" | "dev_to_pm"
export type Lens = "dev" | "pm"
export type Period = "30" | "90" | "month" | "year"
export type AspectId = "delivery" | "followup" | "communication" | "scope"
export type TaskStatus = "in_progress" | "completed"
export type Role = "PM" | "Dev"

export type Aspect = {
  id: AspectId
  label: string
}

export type Person = {
  id: string
  name: string
  role: Role
  email?: string
}

export type Project = {
  id: string
  name: string
  color: string
}

export type Task = {
  id: string
  title: string
  summary: string
  projectId: string
  devId: string
  pmId: string
  /** Teamwork assignees. Visibility uses this; Dev for ratings is still `devId`. */
  assigneeIds?: string[]
  status: TaskStatus
  startedAt: string
  completedAt: string | null
}

export type Scores = Partial<Record<AspectId, number>>

export type Review = {
  id: string
  taskId: string
  direction: Direction
  raterId: string
  rateeId: string
  scores: Scores
  detail: string
  createdAt: string
}

export type SaveReviewResult = {
  published: boolean
  publishError?: string
}

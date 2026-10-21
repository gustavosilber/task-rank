export type TeamworkAuthMode = "apiKey" | "password"

export type TeamworkConnection = {
  siteUrl: string
  authMode: TeamworkAuthMode
  apiKey: string
  email: string
  password: string
  defaultPmId: string
}

/** App session (Google or Teamwork /me fallback). */
export type TeamworkSession = {
  provider: "google" | "teamwork"
  personId: string
  email: string
  name: string
  picture?: string
  isSuperUser: boolean
  /** Google ID token for the ratings API. Kept in sessionStorage, not localStorage. */
  googleCredential?: string
}

export function isSuperUserEmail(email: string): boolean {
  return email.trim().toLowerCase() === "dev@bestworlddsweb.com"
}

export type TwPerson = {
  id: number | string
  firstName?: string
  lastName?: string
  "first-name"?: string
  "last-name"?: string
  fullName?: string
  name?: string
  title?: string
  email?: string
  "email-address"?: string
  deleted?: boolean
  type?: string
  userType?: string
}

export type TwActivity = {
  id?: number | string
  activityType?: string
  itemId?: number | string
  itemType?: string
  userId?: number | string
  fromUserId?: number | string
  forUserId?: number | string
  user?: { id?: number | string }
  fromUser?: { id?: number | string }
  forUser?: { id?: number | string }
}

export type TwProject = {
  id: number | string
  name?: string
  status?: string
  projectStatus?: string
}

export type TwTasklist = {
  id: number | string
  name?: string
  projectId?: number | string
  project?: { id?: number | string }
}

export type TwTask = {
  id: number | string
  name?: string
  description?: string
  status?: string
  completed?: boolean
  projectId?: number | string
  project?: { id?: number | string }
  tasklistId?: number | string
  tasklist?: { id?: number | string }
  "todo-list-id"?: number | string
  createdAt?: string
  updatedAt?: string
  startDate?: string
  startAt?: string
  dateCreated?: string
  "created-on"?: string
  completedAt?: string
  dateCompleted?: string
  completedDate?: string
  "completed-on"?: string
  createdBy?: number | string
  createdByUserId?: number | string
  "created-by-user-id"?: number | string
  completedBy?: number | string
  completedByUserId?: number | string
  "completed-by-user-id"?: number | string
  updatedBy?: number | string
  updatedByUserId?: number | string
  "updated-by-user-id"?: number | string
  responsiblePartyIds?: number[] | string
  responsiblePartyId?: number | string
  "responsible-party-ids"?: string
  "responsible-party-id"?: string | number
  assigneeUserIds?: Array<number | string>
  assignedToUserIds?: Array<number | string>
  assignees?: {
    userIds?: Array<number | string>
    users?: Array<number | string | { id?: number | string }>
    companyIds?: number[]
    teamIds?: number[]
  }
  comments?: Array<{
    postedBy?: number | string | { id?: number | string }
    postedByUserId?: number | string
    createdBy?: number | string | { id?: number | string }
  }>
}

export type SyncDiagnostics = {
  rawPeople: number
  rawProjects: number
  rawTasks: number
  mappedPeople: number
  mappedProjects: number
  mappedTasks: number
  droppedNoProject: number
  droppedNoDev: number
  droppedUnknownProject: number
  sampleTaskKeys: string[]
  tasklists: number
  tasksWithAssignees: number
}

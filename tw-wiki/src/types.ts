export type WikiSource = {
  taskId: string
  taskTitle: string
  projectId: string
  projectName: string
  commentId: string | null
}

export type WikiRecord = {
  id: string
  siteId: string
  title: string
  summary?: string
  context: string
  information: string
  tags: string[]
  source: WikiSource
  elaborated?: boolean
  updatedAt: string
}

export type WikiSite = {
  id: string
  name: string
  projectId: string
  recordIds: string[]
}

export type WikiStore = {
  sites: WikiSite[]
  records: WikiRecord[]
  syncedAt: string | null
}

export type TwProject = {
  id: number | string
  name?: string
}

export type TwTask = {
  id: number | string
  name?: string
  description?: string
  status?: string
  completed?: boolean
  projectId?: number | string
  project?: { id?: number | string }
}

export type TwComment = {
  id?: number | string
  body?: string
  html?: string
  htmlBody?: string
  content?: string
  "html-body"?: string
}

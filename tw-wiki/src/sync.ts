import {
  extractNotesBody,
  hasTechnicalNotes,
  isGgBaileyProject,
  notesFromTask,
  siteIdFromName,
  stripHtml,
} from "./extract"
import { fetchProjectTasks, fetchProjects, fetchTaskComments } from "./teamwork"
import type { WikiRecord, WikiSite } from "./types"

const WIKI_NAME = "GGBailey"
const WIKI_ID = siteIdFromName(WIKI_NAME)

export type SyncProgress = {
  projects: number
  tasks: number
  notes: number
  message: string
}

async function organizeRecord(input: {
  projectName: string
  taskTitle: string
  taskSummary: string
  notes: string
}): Promise<{ title: string; summary?: string; context: string; information: string; tags: string[] }> {
  try {
    const response = await fetch("/api/organize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
    if (!response.ok) throw new Error("organize failed")
    return (await response.json()) as { title: string; summary?: string; context: string; information: string; tags: string[] }
  } catch {
    return {
      title: input.taskTitle,
      context: `Client / site: ${input.projectName}\nTask: ${input.taskTitle}\n${input.taskSummary}`.trim(),
      information: extractNotesBody(input.notes),
      tags: [input.projectName],
    }
  }
}

export async function syncWiki(onProgress?: (progress: SyncProgress) => void): Promise<{
  sites: WikiSite[]
  records: WikiRecord[]
}> {
  const projects = (await fetchProjects()).filter((project) => isGgBaileyProject(project.name ?? ""))
  if (projects.length === 0) {
    throw new Error("No active Teamwork project matched GGBailey. Check the project name in Teamwork.")
  }

  const sites: WikiSite[] = []
  const records: WikiRecord[] = []
  let scanned = 0
  let notes = 0
  const recordIds: string[] = []

  onProgress?.({
    projects: projects.length,
    tasks: 0,
    notes: 0,
    message: `Pilot: ${projects.map((project) => project.name).join(", ")}. Scanning active tasks for Internal Notes…`,
  })

  for (const project of projects) {
    if (project.id == null) continue
    const projectId = String(project.id)
    const projectName = project.name?.trim() || WIKI_NAME
    const tasks = await fetchProjectTasks(projectId)

    onProgress?.({
      projects: projects.length,
      tasks: tasks.length,
      notes,
      message: `${projectName}: ${tasks.length} active tasks. Looking for Internal Notes…`,
    })

    for (const task of tasks) {
      scanned += 1
      const description = stripHtml(task.description ?? "")
      const comments = hasTechnicalNotes(description) ? [] : await fetchTaskComments(String(task.id))
      const found = notesFromTask(task, comments)
      if (found) {
        const organized = await organizeRecord({
          projectName: WIKI_NAME,
          taskTitle: task.name?.trim() || `Task ${task.id}`,
          taskSummary: description,
          notes: found.text,
        })
        const recordId = `${WIKI_ID}:${task.id}`
        recordIds.push(recordId)
        notes += 1
        records.push({
          id: recordId,
          siteId: WIKI_ID,
          title: organized.title,
          summary: organized.summary,
          context: organized.context,
          information: organized.information,
          tags: organized.tags,
          source: {
            taskId: String(task.id),
            taskTitle: task.name?.trim() || `Task ${task.id}`,
            projectId,
            projectName,
            commentId: found.commentId,
          },
          updatedAt: new Date().toISOString(),
        })
      }

      onProgress?.({
        projects: projects.length,
        tasks: scanned,
        notes,
        message: `GGBailey · ${scanned}/${tasks.length} active tasks · ${notes} Internal Notes`,
      })
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }

  if (recordIds.length) {
    sites.push({ id: WIKI_ID, name: WIKI_NAME, projectId: String(projects[0].id), recordIds })
  }

  return { sites, records }
}

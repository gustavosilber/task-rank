import type { WikiRecord } from "./types"

export type WikiDraft = {
  title: string
  summary: string
  context: string
  information: string
  tags: string[]
}

export async function elaborateRecordViaApi(record: WikiRecord): Promise<WikiRecord> {
  const response = await fetch("/api/organize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectName: record.source.projectName || "GGBailey",
      taskTitle: record.source.taskTitle,
      taskSummary: [record.context, record.summary].filter(Boolean).join("\n"),
      notes: record.information,
    }),
  })
  if (!response.ok) throw new Error("Could not elaborate the saved wiki record.")
  const draft = (await response.json()) as WikiDraft
  return {
    ...record,
    title: draft.title || record.title,
    summary: draft.summary || record.summary,
    context: draft.context || record.context,
    information: draft.information || record.information,
    tags: draft.tags?.length ? draft.tags : record.tags,
    elaborated: true,
    updatedAt: new Date().toISOString(),
  }
}

export async function elaborateStoreRecords(records: WikiRecord[], force = false): Promise<{ records: WikiRecord[]; changed: number }> {
  let changed = 0
  const next: WikiRecord[] = []
  for (const record of records) {
    if (record.elaborated && !force) {
      next.push(record)
      continue
    }
    next.push(await elaborateRecordViaApi(record))
    changed += 1
  }
  return { records: next, changed }
}

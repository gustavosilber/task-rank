import type { WikiRecord, WikiSite, WikiStore } from "./types"

const KEY = "tw-wiki:store:v1"

export const EMPTY_STORE: WikiStore = { sites: [], records: [], syncedAt: null }

export function loadStore(): WikiStore {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY_STORE
    const parsed = JSON.parse(raw) as WikiStore
    if (!Array.isArray(parsed.sites) || !Array.isArray(parsed.records)) return EMPTY_STORE
    return parsed
  } catch {
    return EMPTY_STORE
  }
}

export function saveStore(store: WikiStore) {
  localStorage.setItem(KEY, JSON.stringify(store))
}

export function mergeStore(current: WikiStore, incoming: { sites: WikiSite[]; records: WikiRecord[] }): WikiStore {
  const recordsById = new Map(current.records.map((record) => [record.id, record]))
  for (const record of incoming.records) recordsById.set(record.id, record)
  const records = [...recordsById.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  const sitesById = new Map(current.sites.map((site) => [site.id, site]))
  for (const site of incoming.sites) {
    const existing = sitesById.get(site.id)
    const recordIds = new Set([...(existing?.recordIds ?? []), ...site.recordIds])
    sitesById.set(site.id, { ...site, recordIds: [...recordIds] })
  }

  return {
    sites: [...sitesById.values()].sort((a, b) => a.name.localeCompare(b.name, "en")),
    records,
    syncedAt: new Date().toISOString(),
  }
}

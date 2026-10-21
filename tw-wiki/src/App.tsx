import { useMemo, useState } from "react"
import { elaborateStoreRecords } from "./elaborate"
import { loadStore, mergeStore, saveStore } from "./store"
import { syncWiki, type SyncProgress } from "./sync"
import { teamworkConnection } from "./teamwork"
import type { WikiStore } from "./types"

function formatWhen(value: string | null): string {
  if (!value) return "Never"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export function App() {
  const [store, setStore] = useState<WikiStore>(loadStore)
  const [siteId, setSiteId] = useState(loadStore().sites[0]?.id ?? "")
  const [busy, setBusy] = useState<"idle" | "scan" | "write">("idle")
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { siteUrl, apiKey } = teamworkConnection()

  const site = store.sites.find((item) => item.id === siteId) ?? store.sites[0]
  const records = useMemo(
    () => store.records.filter((record) => record.siteId === (site?.id ?? "")),
    [store.records, site?.id],
  )

  async function onElaborate() {
    if (store.records.length === 0) return
    setBusy("write")
    setError(null)
    setProgress({
      projects: store.sites.length,
      tasks: store.records.length,
      notes: store.records.length,
      message: "Writing wiki articles from the saved Internal Notes. Teamwork is not being synced.",
    })
    try {
      const { records: nextRecords, changed } = await elaborateStoreRecords(store.records, true)
      const next = { ...store, records: nextRecords }
      setStore(next)
      saveStore(next)
      setProgress({
        projects: next.sites.length,
        tasks: next.records.length,
        notes: next.records.length,
        message: changed
          ? `Wrote ${changed} wiki article${changed === 1 ? "" : "s"} from local storage.`
          : "Nothing new to elaborate.",
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not elaborate the saved records.")
    } finally {
      setBusy("idle")
    }
  }

  async function onSync() {
    setBusy("scan")
    setError(null)
    setProgress({ projects: 0, tasks: 0, notes: 0, message: "Connecting to Teamwork…" })
    try {
      const incoming = await syncWiki(setProgress)
      const next = mergeStore(store, incoming)
      setStore(next)
      saveStore(next)
      setSiteId((current) => (next.sites.some((item) => item.id === current) ? current : (next.sites[0]?.id ?? "")))
      setProgress({
        projects: next.sites.length,
        tasks: incoming.records.length,
        notes: incoming.records.length,
        message: incoming.records.length
          ? `Indexed ${incoming.records.length} Internal Notes into the GGBailey wiki. Use Write wiki articles to elaborate them.`
          : "Scan finished. No Internal Notes were found on active GGBailey tasks.",
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sync Teamwork.")
    } finally {
      setBusy("idle")
    }
  }

  return (
    <div>
      <header className="topbar">
        <div className="wrap bar">
          <div className="brand">
            <strong>TW Wiki</strong>
            <span>GGBailey pilot</span>
          </div>
          <div className="bar-end">
            <button type="button" className="ghost" disabled={busy !== "idle" || store.records.length === 0} onClick={onElaborate}>
              {busy === "write" ? "Writing wiki…" : "Write wiki articles"}
            </button>
            <button type="button" className="primary" disabled={busy !== "idle" || !apiKey} onClick={onSync}>
              {busy === "scan" ? "Scanning GGBailey…" : "Scan GGBailey"}
            </button>
          </div>
        </div>
      </header>

      <main className="wrap">
        <h1>Client wikis</h1>
        <p className="lede">
          Pilot for <strong>GGBailey</strong>. Scan pulls Internal Notes from active tasks.{" "}
          <strong>Write wiki articles</strong> uses the copy already in this browser and turns it into operational wiki
          prose: when it applies, what to verify, and in which environment. It does not sync Teamwork again.
        </p>

        {!apiKey && (
          <p className="error-line">Add VITE_TEAMWORK_API_KEY to the parent .env and restart this app.</p>
        )}
        {progress && <p className="saved">{progress.message}</p>}
        {error && <p className="error-line">{error}</p>}
        <p className="meta">
          Site {siteUrl} · Last sync {formatWhen(store.syncedAt)}
        </p>

        {store.sites.length > 0 && (
          <div className="sites" role="group" aria-label="Client wiki">
            {store.sites.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === site?.id ? "chip on" : "chip"}
                onClick={() => setSiteId(item.id)}
              >
                {item.name}
                <small>{item.recordIds.length} records</small>
              </button>
            ))}
          </div>
        )}

        {site ? (
          <>
            <h2>{site.name}</h2>
            {records.length === 0 ? (
              <p className="empty">This wiki has no Internal Notes records yet.</p>
            ) : (
              records.map((record) => (
                <article key={record.id} className="card">
                  <h3>{record.title}</h3>
                  <p className="meta">
                    From task {record.source.taskTitle}
                    {record.elaborated ? " · wiki article" : " · raw Internal Notes"}
                  </p>
                  {record.summary && (
                    <>
                      <p className="label">Summary</p>
                      <p className="block">{record.summary}</p>
                    </>
                  )}
                  <p className="label">Context</p>
                  <p className="block">{record.context}</p>
                  <p className="label">Wiki</p>
                  <p className="block">{record.information}</p>
                  {record.tags.length > 0 && (
                    <div className="tags">
                      {record.tags.map((tag) => (
                        <span key={tag} className="tag">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="meta">
                    <a className="link" href={`${siteUrl}/#/tasks/${record.source.taskId}`} target="_blank" rel="noreferrer">
                      Open task in Teamwork
                    </a>
                  </p>
                </article>
              ))
            )}
          </>
        ) : (
          <p className="empty">Scan GGBailey to collect Internal Notes, then write the wiki articles.</p>
        )}
      </main>
    </div>
  )
}

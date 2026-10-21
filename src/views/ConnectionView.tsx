import { useEffect, useState } from "react"
import { TeamworkError, testConnection } from "../teamwork/client"
import { DEFAULT_TEAMWORK_SITE } from "../teamwork/config"
import { syncTeamworkWorkspace } from "../teamwork/sync"
import type { TeamworkAuthMode, TeamworkConnection } from "../teamwork/types"
import { useWorkspace } from "../WorkspaceContext"
import { formatDate, iso } from "../model"
import { sessionFromMe } from "../workspace"

export function ConnectionView() {
  const {
    workspace,
    connection,
    people,
    session,
    setConnection,
    setSession,
    applyTeamworkWorkspace,
    useDemo,
    syncing,
    syncError,
  } = useWorkspace()
  const [siteUrl, setSiteUrl] = useState(connection?.siteUrl ?? DEFAULT_TEAMWORK_SITE)
  const [authMode, setAuthMode] = useState<TeamworkAuthMode>(connection?.authMode ?? "apiKey")
  const [apiKey, setApiKey] = useState(connection?.apiKey ?? "")
  const [email, setEmail] = useState(connection?.email ?? "")
  const [password, setPassword] = useState(connection?.password ?? "")
  const [defaultPmId, setDefaultPmId] = useState(connection?.defaultPmId ?? "")
  const [busy, setBusy] = useState<"idle" | "test" | "sync">("idle")
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!connection) return
    setSiteUrl(connection.siteUrl)
    setAuthMode(connection.authMode)
    setApiKey(connection.apiKey)
    setEmail(connection.email)
    setPassword(connection.password)
    setDefaultPmId(connection.defaultPmId)
  }, [connection])

  const draft: TeamworkConnection = {
    siteUrl: siteUrl.trim(),
    authMode,
    apiKey: apiKey.trim(),
    email: email.trim(),
    password,
    defaultPmId,
  }

  const canSubmit =
    Boolean(draft.siteUrl) && (authMode === "apiKey" ? Boolean(draft.apiKey) : Boolean(draft.email && draft.password))

  function persist(next: TeamworkConnection) {
    setConnection(next)
  }

  async function onTest() {
    setBusy("test")
    setError(null)
    setMessage(null)
    try {
      const result = await testConnection(draft)
      persist(draft)
      if (!session || session.provider !== "google") {
        setSession(sessionFromMe(result.me))
      }
      setMessage(`Connected to ${result.site} (${result.people} people). The API key is saved for every user on this app.`)
    } catch (err) {
      setError(err instanceof TeamworkError ? err.message : "Could not test the connection.")
    } finally {
      setBusy("idle")
    }
  }

  async function onSync() {
    setBusy("sync")
    setError(null)
    setMessage(null)
    try {
      persist(draft)
      const result = await syncTeamworkWorkspace(draft, session)
      applyTeamworkWorkspace(
        {
          people: result.people,
          projects: result.projects,
          tasks: result.tasks,
          syncedAt: new Date().toISOString(),
        },
        result.session,
      )
      setMessage(result.message)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sync.")
    } finally {
      setBusy("idle")
    }
  }

  const connected = Boolean(connection?.apiKey || (connection?.email && connection?.password))

  return (
    <section>
      <h1>Teamwork</h1>
      <p className="lede">
        Google is only for signing in. Teamwork is read-only and uses one shared API key for every user. Ratings stay in
        Task Rank. <code>dev@bestworlddsweb.com</code> sees everyone; other people only see their own tasks.
      </p>

      {session?.isSuperUser ? (
        <div className="card connection-card">
          <label className="field">
            <span>Site URL</span>
            <input
              value={siteUrl}
              onChange={(event) => setSiteUrl(event.target.value)}
              placeholder={DEFAULT_TEAMWORK_SITE}
              autoComplete="off"
            />
          </label>

          <div className="segment auth-mode" role="group" aria-label="Access method">
            <button type="button" className={authMode === "apiKey" ? "on" : ""} aria-pressed={authMode === "apiKey"} onClick={() => setAuthMode("apiKey")}>
              API key
            </button>
            <button type="button" className={authMode === "password" ? "on" : ""} aria-pressed={authMode === "password"} onClick={() => setAuthMode("password")}>
              Email and password
            </button>
          </div>

          {authMode === "apiKey" ? (
            <label className="field">
              <span>API key</span>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                onBlur={() => {
                  if (draft.siteUrl && draft.apiKey) persist({ ...draft, authMode: "apiKey" })
                }}
                placeholder="Token from your Teamwork profile"
                autoComplete="off"
              />
              <em className="hint">Saved for all users. You only need to paste it once.</em>
            </label>
          ) : (
            <>
              <label className="field">
                <span>Teamwork email</span>
                <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" autoComplete="username" />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="The same password you use for Teamwork"
                  autoComplete="current-password"
                />
              </label>
            </>
          )}

          <label className="field">
            <span>Default PM (optional)</span>
            <select value={defaultPmId} onChange={(event) => setDefaultPmId(event.target.value)}>
              <option value="">Use creator / second assignee</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
            <em className="hint">If the task has no PM different from the assignee, this person is used.</em>
          </label>

          <div className="form-actions">
            <button type="button" className="ghost" disabled={busy !== "idle"} onClick={useDemo}>
              Back to demo data
            </button>
            <button type="button" className="ghost" disabled={busy !== "idle" || !canSubmit} onClick={onTest}>
              {busy === "test" ? "Testing…" : "Test connection"}
            </button>
            <button type="button" className="primary" disabled={busy !== "idle" || !canSubmit} onClick={onSync}>
              {busy === "sync" ? "Syncing…" : "Sync tasks"}
            </button>
          </div>

          {message && <p className="saved">{message}</p>}
          {(error || syncError) && <p className="error-line">{error || syncError}</p>}
        </div>
      ) : (
        <div className="card connection-card">
          <p className="lede">
            {connected
              ? "Teamwork is already connected with the shared API key. You do not need to enter credentials."
              : "Teamwork is not connected yet. Ask an admin to paste the API key once."}
          </p>
          {syncing && <p className="saved">Syncing tasks from Teamwork…</p>}
          {syncError && <p className="error-line">{syncError}</p>}
        </div>
      )}

      <div className="meta connection-meta">
        <div>
          <dt>Current source</dt>
          <dd>{workspace.source === "teamwork" ? "Teamwork" : "Demo"}</dd>
        </div>
        <div>
          <dt>Connection</dt>
          <dd>{connected ? `${connection?.siteUrl ?? DEFAULT_TEAMWORK_SITE} · saved` : "Not saved"}</dd>
        </div>
        <div>
          <dt>Session</dt>
          <dd>
            {session
              ? `${session.name || session.email}${session.isSuperUser ? " · superuser" : ""}`
              : "Not signed in"}
          </dd>
        </div>
        <div>
          <dt>Last sync</dt>
          <dd>{workspace.syncedAt ? formatDate(iso(new Date(workspace.syncedAt))) : "—"}</dd>
        </div>
        <div>
          <dt>Tasks in memory</dt>
          <dd>{workspace.tasks.length}</dd>
        </div>
      </div>
    </section>
  )
}

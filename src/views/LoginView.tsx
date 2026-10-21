import { useEffect, useRef, useState } from "react"
import { googleClientId, renderGoogleButton } from "../auth/google"
import { useWorkspace } from "../WorkspaceContext"
import { sessionFromGoogle } from "../workspace"

export function LoginView() {
  const { workspace, people, setSession, useDemo } = useWorkspace()
  const buttonRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const clientId = googleClientId()

  useEffect(() => {
    const parent = buttonRef.current
    if (!parent || !clientId) return
    let dispose: () => void = () => undefined
    let active = true
    renderGoogleButton(
      parent,
      (profile, credential) => {
        if (!active) return
        setSession(sessionFromGoogle(profile, people.length ? people : workspace.people, credential))
      },
      (message) => {
        if (active) setError(message)
      },
    ).then((cleanup) => {
      if (!active) cleanup()
      else dispose = cleanup
    })
    return () => {
      active = false
      dispose()
    }
  }, [clientId, people, setSession, workspace.people])

  return (
    <div className="login-screen">
      <div className="login-card">
        <p className="login-brand">Task Rank</p>
        <h1>Sign in with Google</h1>
        <p className="lede">
          Sign in with Google. Task Rank opens your tasks from the shared Teamwork snapshot.
        </p>

        {clientId ? (
          <div className="google-btn-wrap" ref={buttonRef} />
        ) : (
          <p className="error-line">
            Set <code>VITE_GOOGLE_CLIENT_ID</code> in a <code>.env</code> file (OAuth Web Client ID from Google Cloud) and
            restart Vite.
          </p>
        )}

        {error && <p className="error-line">{error}</p>}

        <div className="login-divider">
          <span>or</span>
        </div>

        <button type="button" className="ghost login-demo" onClick={useDemo}>
          Continue with demo data
        </button>
      </div>
    </div>
  )
}

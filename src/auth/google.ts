export type GoogleProfile = {
  email: string
  name: string
  picture?: string
  sub: string
}

type CredentialResponse = {
  credential?: string
}

type GoogleAccountsId = {
  initialize: (config: {
    client_id: string
    callback: (response: CredentialResponse) => void
    auto_select?: boolean
    cancel_on_tap_outside?: boolean
  }) => void
  renderButton: (
    parent: HTMLElement,
    options: {
      theme?: "outline" | "filled_blue" | "filled_black"
      size?: "large" | "medium" | "small"
      text?: "signin_with" | "continue_with" | "signup_with"
      shape?: "rectangular" | "pill" | "circle" | "square"
      width?: number
      locale?: string
    },
  ) => void
  disableAutoSelect: () => void
  revoke: (hint: string, callback: () => void) => void
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } }
  }
}

const SCRIPT_SRC = "https://accounts.google.com/gsi/client"

export function googleClientId(): string {
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? ""
}

function loadGisScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve()
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true })
      existing.addEventListener("error", () => reject(new Error("Could not load Google Sign-In.")), { once: true })
    })
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = SCRIPT_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error("Could not load Google Sign-In."))
    document.head.appendChild(script)
  })
}

/** Decode the ID token payload (client-side POC; signature is not verified). */
export function profileFromCredential(credential: string): GoogleProfile {
  const parts = credential.split(".")
  if (parts.length < 2) throw new Error("Invalid Google token.")
  const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
  const payload = JSON.parse(json) as {
    email?: string
    email_verified?: boolean
    name?: string
    picture?: string
    sub?: string
  }
  if (!payload.email || !payload.sub) throw new Error("Google did not return an email.")
  if (payload.email_verified === false) throw new Error("The Google email is not verified.")
  return {
    email: payload.email,
    name: payload.name?.trim() || payload.email,
    picture: payload.picture,
    sub: payload.sub,
  }
}

export async function renderGoogleButton(
  parent: HTMLElement,
  onProfile: (profile: GoogleProfile, credential: string) => void,
  onError: (message: string) => void,
): Promise<() => void> {
  const clientId = googleClientId()
  if (!clientId) {
    onError("VITE_GOOGLE_CLIENT_ID is missing from the environment.")
    return () => undefined
  }

  await loadGisScript()
  const gis = window.google?.accounts?.id
  if (!gis) {
    onError("Google Sign-In is not available.")
    return () => undefined
  }

  parent.innerHTML = ""
  gis.initialize({
    client_id: clientId,
    callback: (response) => {
      try {
        if (!response.credential) throw new Error("Google did not return a credential.")
        onProfile(profileFromCredential(response.credential), response.credential)
      } catch (error) {
        onError(error instanceof Error ? error.message : "Could not sign in with Google.")
      }
    },
    auto_select: false,
    cancel_on_tap_outside: true,
  })
  gis.renderButton(parent, {
    theme: "outline",
    size: "large",
    text: "signin_with",
    shape: "rectangular",
    width: 320,
    locale: "en",
  })

  return () => {
    parent.innerHTML = ""
  }
}

export function signOutGoogle(email?: string) {
  try {
    window.google?.accounts.id.disableAutoSelect()
    if (email) window.google?.accounts.id.revoke(email, () => undefined)
  } catch {
    // ignore
  }
}

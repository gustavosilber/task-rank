import { isSuperUserEmail } from "../src/teamwork/types"

export type AuthUser = {
  email: string
  name: string
  isSuperUser: boolean
}

type GoogleTokenInfo = {
  aud?: string
  email?: string
  email_verified?: string | boolean
  name?: string
  error?: string
  error_description?: string
}

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function googleClientId(): string {
  return process.env.GOOGLE_CLIENT_ID?.trim() || process.env.VITE_GOOGLE_CLIENT_ID?.trim() || ""
}

export async function verifyGoogleUser(authorization: string): Promise<AuthUser> {
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : ""
  if (!token) throw new HttpError(401, "Sign in with Google to load or save ratings.")

  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`)
  const payload = (await response.json()) as GoogleTokenInfo
  if (!response.ok || payload.error || !payload.email) {
    throw new HttpError(401, payload.error_description || payload.error || "Google session expired. Sign in again.")
  }

  const clientId = googleClientId()
  if (clientId && payload.aud !== clientId) {
    throw new HttpError(401, "Google token does not match this app.")
  }
  if (payload.email_verified === false || payload.email_verified === "false") {
    throw new HttpError(401, "The Google email is not verified.")
  }

  const email = payload.email.trim().toLowerCase()
  return {
    email,
    name: payload.name?.trim() || email,
    isSuperUser: isSuperUserEmail(email),
  }
}

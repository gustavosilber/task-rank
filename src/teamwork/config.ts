import type { TeamworkConnection } from "./types"

export const DEFAULT_TEAMWORK_SITE = "https://bestworldsweb.teamwork.com"

export function envTeamworkConnection(): TeamworkConnection | null {
  const siteUrl = (import.meta.env.VITE_TEAMWORK_SITE_URL as string | undefined)?.trim() || DEFAULT_TEAMWORK_SITE
  const apiKey = (import.meta.env.VITE_TEAMWORK_API_KEY as string | undefined)?.trim() ?? ""
  if (!apiKey) return null
  return {
    siteUrl,
    authMode: "apiKey",
    apiKey,
    email: "",
    password: "",
    defaultPmId: "",
  }
}

export function isUsableConnection(connection: TeamworkConnection | null | undefined): connection is TeamworkConnection {
  if (!connection?.siteUrl) return false
  if (connection.authMode === "password") return Boolean(connection.email && connection.password)
  return Boolean(connection.apiKey)
}

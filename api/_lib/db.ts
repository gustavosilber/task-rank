import { neon } from "@neondatabase/serverless"

let schemaReady: Promise<void> | null = null

export function databaseUrl(): string {
  return process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim() || ""
}

export function sql() {
  const url = databaseUrl()
  if (!url) {
    const error = new Error("DATABASE_URL is not set. Add a Neon connection string.")
    ;(error as Error & { status: number }).status = 503
    throw error
  }
  return neon(url)
}

export async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const query = sql()
      await query`
        CREATE TABLE IF NOT EXISTS reviews (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          direction TEXT NOT NULL CHECK (direction IN ('pm_to_dev', 'dev_to_pm')),
          rater_id TEXT NOT NULL,
          ratee_id TEXT NOT NULL,
          rater_email TEXT NOT NULL,
          ratee_email TEXT NOT NULL DEFAULT '',
          saved_by_email TEXT NOT NULL,
          scores JSONB NOT NULL,
          detail TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (task_id, direction)
        )
      `
      await query`CREATE INDEX IF NOT EXISTS reviews_saved_by_email_idx ON reviews (saved_by_email)`
      await query`CREATE INDEX IF NOT EXISTS reviews_rater_email_idx ON reviews (rater_email)`
      await query`CREATE INDEX IF NOT EXISTS reviews_ratee_email_idx ON reviews (ratee_email)`
      await query`CREATE INDEX IF NOT EXISTS reviews_task_id_idx ON reviews (task_id)`
    })().catch((error) => {
      schemaReady = null
      throw error
    })
  }
  await schemaReady
}

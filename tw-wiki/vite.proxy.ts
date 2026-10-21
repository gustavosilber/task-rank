import type { IncomingMessage, ServerResponse } from "node:http"
import { resolve } from "node:path"
import { loadEnv, type Plugin } from "vite"

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on("end", () => resolveBody(Buffer.concat(chunks)))
    req.on("error", reject)
  })
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader("Content-Type", "application/json")
  res.end(JSON.stringify(payload))
}

function headerValue(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : ""
}

const WIKI_SYSTEM_PROMPT = `You write internal operations wiki articles for a web agency.

Turn Internal Notes + the Teamwork task context into a finished wiki entry, written as operational knowledge, not as a dump of the comment.

Voice and shape:
- Use complete sentences.
- Prefer this cadence: "When we need to [goal], the required fields / data are [x]. When [request or case] comes in, we must verify [y]. This applies when we are in the [environment / store / site] ..."
- Explain WHEN it applies, WHAT to check or prepare, and WHERE (environment, store, client site).
- Write as if the next teammate will follow this without opening Teamwork.

Rules:
- Use only facts present or clearly implied in the notes and task context.
- Do not invent product names, fields, APIs, credentials, or environments.
- If a detail is missing, say what should be confirmed instead of fabricating it.
- Keep the client name (e.g. GGBailey) visible in the context.
- Return JSON only: title, summary, context, information, tags (array of short strings).
- information must be a multi-paragraph wiki article, not a bullet dump unless the source is itself a list of required fields.`

export function teamworkWikiProxy(): Plugin {
  return {
    name: "tw-wiki-proxy",
    configureServer(server) {
      const env = loadEnv(server.config.mode, resolve(server.config.root, ".."), "")
      Object.assign(process.env, env)

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/teamwork") && !req.url?.startsWith("/api/organize")) return next()

        if (req.url.startsWith("/api/organize")) {
          try {
            const raw = await readBody(req)
            const payload = JSON.parse(raw.toString("utf8") || "{}") as OrganizeInput
            const organized = await organizeWithOptionalAi(payload)
            return sendJson(res, 200, organized)
          } catch (error) {
            return sendJson(res, 500, {
              error: error instanceof Error ? error.message : "Could not organize the wiki record.",
            })
          }
        }

        const site = headerValue(req.headers["x-teamwork-site"])
        const token = headerValue(req.headers["x-teamwork-token"])
        if (!site) return sendJson(res, 401, { error: "Missing X-Teamwork-Site." })
        if (!token) return sendJson(res, 401, { error: "Missing Teamwork API key." })

        let base: URL
        try {
          base = new URL(site)
        } catch {
          return sendJson(res, 400, { error: "X-Teamwork-Site is not a valid URL." })
        }

        const incoming = new URL(req.url, "http://localhost")
        const targetPath = incoming.pathname.replace(/^\/api\/teamwork/, "") || "/"
        const target = new URL(targetPath + incoming.search, base)
        const headers: Record<string, string> = {
          Accept: "application/json",
          Authorization: `Basic ${Buffer.from(`${token}:xxx`).toString("base64")}`,
        }

        try {
          const upstream = await fetch(target, { method: req.method ?? "GET", headers })
          const buffer = Buffer.from(await upstream.arrayBuffer())
          res.statusCode = upstream.status
          const contentType = upstream.headers.get("content-type")
          if (contentType) res.setHeader("Content-Type", contentType)
          const retryAfter = upstream.headers.get("retry-after")
          if (retryAfter) res.setHeader("Retry-After", retryAfter)
          res.end(buffer)
        } catch (error) {
          sendJson(res, 502, {
            error: error instanceof Error ? error.message : "Could not reach Teamwork.",
          })
        }
      })
    },
  }
}

type OrganizeInput = {
  projectName?: string
  taskTitle?: string
  taskSummary?: string
  notes?: string
}

type WikiDraft = {
  title: string
  summary: string
  context: string
  information: string
  tags: string[]
}

async function organizeWithOptionalAi(input: OrganizeInput): Promise<WikiDraft> {
  const fallback = organizeLocally(input)
  const openAi = process.env.OPENAI_API_KEY?.trim()
  if (!openAi) return fallback

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAi}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: WIKI_SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              client: input.projectName,
              task: input.taskTitle,
              taskContext: input.taskSummary,
              internalNotes: input.notes,
            }),
          },
        ],
      }),
    })
    if (!response.ok) return fallback
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as Partial<WikiDraft>
    return {
      title: parsed.title?.trim() || fallback.title,
      summary: parsed.summary?.trim() || fallback.summary,
      context: parsed.context?.trim() || fallback.context,
      information: parsed.information?.trim() || fallback.information,
      tags: Array.isArray(parsed.tags) && parsed.tags.length ? parsed.tags.map(String) : fallback.tags,
    }
  } catch {
    return fallback
  }
}

function organizeLocally(input: OrganizeInput): WikiDraft {
  const client = input.projectName?.trim() || "GGBailey"
  const task = input.taskTitle?.trim() || "this task"
  const notes = (input.notes ?? "")
    .replace(/^(?:internal|technical)\s*notes\s*[:\-]?\s*/gim, "")
    .replace(/elaborated locally[\s\S]*$/i, "")
    .trim()
  const contextBits = (input.taskSummary ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^client\s*\/\s*site:/i.test(line) && !/^task:/i.test(line) && !/^source task:/i.test(line))
  const environment =
    notes.match(/\b(amazon|shopify|staging|production|prod|sandbox|uat|dev|store|magento|bigcommerce)\b/i)?.[1] ??
    contextBits.join(" ").match(/\b(amazon|shopify|staging|production|prod|sandbox|uat)\b/i)?.[1] ??
    `${client} site`

  const noteSentences = notes
    .split(/(?<=[.!?])\s+|\n+/)
    .map((item) => item.replace(/^[-*•]\s*/, "").trim())
    .filter((item) => item.length > 8 && !/^keep this as the client-facing/i.test(item))

  const fields = noteSentences.filter((item) => /field|column|sku|asin|csv|feed|required|must|need/i.test(item))
  const checks = noteSentences.filter((item) => /verif|check|confirm|validate|ensure|review/i.test(item))
  const rest = noteSentences.filter((item) => !fields.includes(item) && !checks.includes(item))

  const goal = task.replace(/^(fix|update|add|create|implement|review)\s+/i, "").replace(/\.$/, "")
  const required = fields.length
    ? fields.join(" ")
    : rest[0] || "the details captured in the Internal Notes for this task"
  const verify = checks.length
    ? checks.join(" ")
    : rest[1] || "the request matches the current client setup before making changes"
  const extra = rest.slice(fields.length ? 0 : 2).join(" ")

  const information = [
    `When we need to ${goal.toLowerCase()} for ${client}, the required information is ${required.replace(/\.$/, "")}.`,
    `When that request comes in, we must verify ${verify.replace(/\.$/, "").replace(/^the /, "")}.`,
    `This is the case when we are working in the ${environment} environment / store.`,
    extra ? `Additional notes from the task: ${extra}` : "",
    contextBits[0] ? `Task context: ${contextBits.slice(0, 3).join(" ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")

  return {
    title: task,
    summary: `How ${client} handles ${goal.toLowerCase()}, including what to prepare and what to verify.`,
    context: `Client wiki: ${client}. This article was written from Internal Notes and the context of the Teamwork task “${task}”.`,
    information,
    tags: [client, environment, ...goal.split(/\s+/).filter((word) => word.length > 3)].slice(0, 8),
  }
}

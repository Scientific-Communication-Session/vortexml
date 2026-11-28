// What the checks know about the site, and small tools for reading a page the
// way a crawler does: as text, without a browser.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')

/** The address every page names as its own, whichever host the checks run against. */
export const CANONICAL = 'https://vortexml.ro'

/** The public pages: public/sitemap.xml is the list the build prerenders. */
export const ROUTES = [...fs.readFileSync(path.join(ROOT, 'public/sitemap.xml'), 'utf8').matchAll(/<loc>https?:\/\/[^/]+([^<]*)<\/loc>/g)]
  .map((m) => m[1] || '/')

/** The lessons, as the backend serves them. */
export const COURSES: { id: string; title: string }[] = JSON.parse(
  fs.readFileSync(path.join(ROOT, '../backend/courses/index.json'), 'utf8'),
)

/** A lesson's own first heading (its file starts with "# …"). */
export const lessonHeading = (id: string) =>
  fs.readFileSync(path.join(ROOT, `../backend/courses/${id}.md`), 'utf8').match(/^# (.+)$/m)![1]

/** Crawlers and agents of the AI companies, as they announce themselves. */
export const AI_AGENTS: Record<string, string> = {
  GPTBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.3; +https://openai.com/gptbot',
  'OAI-SearchBot': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.3; +https://openai.com/searchbot',
  'ChatGPT-User': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
  ClaudeBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  'Claude-User': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)',
  PerplexityBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  'Google-Extended': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  CCBot: 'CCBot/2.0 (https://commoncrawl.org/faq/)',
}

// ── Reading HTML as a crawler does ───────────────────────────────────────────

const decode = (s: string) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ')

/** The readable text of a piece of HTML. */
export const textOf = (html: string) => decode(
  html.replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' '),
).replace(/\s+/g, ' ').trim()

/** The part of a page inside <main>. */
export const mainOf = (html: string) => html.match(/<main\b[^>]*>([\s\S]*)<\/main>/)?.[1] ?? ''

export const headingsOf = (html: string, level: number) =>
  [...html.matchAll(new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)</h${level}>`, 'g'))].map((m) => textOf(m[1]))

/** The value of one tag in <head>, e.g. attr('link', 'rel', 'canonical', 'href'). */
export const attr = (html: string, tag: string, key: string, value: string, wanted: string) => {
  for (const [el] of html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))) {
    if (new RegExp(`\\b${key}="${value}"`).test(el)) return decode(el.match(new RegExp(`\\b${wanted}="([^"]*)"`))?.[1] ?? '')
  }
  return undefined
}

/** Every address a page links to (the body's <a href>), with #fragments dropped. */
export const linksOf = (html: string) => {
  const body = html.slice(html.indexOf('<body'))
  const hrefs = [...body.replace(/<noscript\b[\s\S]*?<\/noscript>/g, '').matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((m) => decode(m[1]))
  return [...new Set(hrefs.map((h) => h.split('#')[0]).filter(Boolean))]
}

// ── robots.txt, read by the rules crawlers follow (RFC 9309) ────────────────

type Group = { agents: string[]; rules: { allow: boolean; path: string }[] }

const groupsOf = (robots: string): Group[] => {
  const groups: Group[] = []
  let current: Group | undefined
  let inAgents = false
  for (const raw of robots.split('\n')) {
    const line = raw.replace(/#.*/, '').trim()
    const [, key, value] = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/) ?? []
    if (!key) continue
    if (/^user-agent$/i.test(key)) {
      if (!inAgents) groups.push(current = { agents: [], rules: [] })
      current!.agents.push(value.toLowerCase())
      inAgents = true
    } else if (/^(allow|disallow)$/i.test(key)) {
      inAgents = false
      if (value) current?.rules.push({ allow: /^allow$/i.test(key), path: value })
    }
  }
  return groups
}

/** May the crawler called `agent` fetch `pathname`? */
export const robotsAllow = (robots: string, agent: string, pathname: string) => {
  const groups = groupsOf(robots)
  const group = groups.find((g) => g.agents.includes(agent.toLowerCase())) ?? groups.find((g) => g.agents.includes('*'))
  if (!group) return true
  // The longest matching rule decides; "allow" wins a tie.
  const matching = group.rules.filter((r) => pathname.startsWith(r.path))
    .sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow))
  return matching.length ? matching[0].allow : true
}

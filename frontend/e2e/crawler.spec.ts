// The site as a crawler or a language model sees it: plain HTTP requests, no
// browser, no JavaScript. Everything here is read-only, so it can also be run
// against the live site (SITE_URL=https://vortexml.ro).
import { expect, test, type APIRequestContext } from '@playwright/test'
import { AI_AGENTS, CANONICAL, COURSES, ROUTES, attr, headingsOf, lessonHeading, linksOf, mainOf, robotsAllow, textOf } from './site.ts'

const get = (request: APIRequestContext, url: string, headers: Record<string, string> = {}) =>
  request.get(url, { headers, maxRedirects: 0 })

const mdFor = (route: string) => (route === '/' ? '/index.md' : `${route}.md`)

test.describe('what crawlers are told', () => {
  test('robots.txt lets every crawler and AI agent read the public pages, and nothing private', async ({ request }) => {
    const res = await get(request, '/robots.txt')
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('text/plain')
    const robots = await res.text()
    expect(robots).toContain(`Sitemap: ${CANONICAL}/sitemap.xml`)
    for (const agent of ['*', 'Googlebot', 'Bingbot', ...Object.keys(AI_AGENTS)]) {
      for (const route of ROUTES) expect(robotsAllow(robots, agent, route), `${agent} may read ${route}`).toBe(true)
      for (const file of ['/llms.txt', '/llms-full.txt', '/tutorial.md', '/api/courses', '/api/demo/datasets']) {
        expect(robotsAllow(robots, agent, file), `${agent} may read ${file}`).toBe(true)
      }
      for (const closed of ['/api/auth/me', '/api/projects', '/socket.io/', '/profile']) {
        expect(robotsAllow(robots, agent, closed), `${agent} is kept out of ${closed}`).toBe(false)
      }
    }
  })

  test('the sitemap lists the pages, by their one address each', async ({ request }) => {
    const res = await get(request, '/sitemap.xml')
    expect(res.status()).toBe(200)
    const served = [...(await res.text()).matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1])
    expect(served).toEqual(ROUTES.map((r) => CANONICAL + r))
    for (const course of COURSES) expect(ROUTES, `the lesson ${course.id} is in the sitemap`).toContain(`/courses/${course.id}`)
  })

  test('every page says where the site describes itself', async ({ request }) => {
    const res = await get(request, '/tutorial')
    const link = res.headers()['link'] ?? ''
    expect(link).toContain('</llms.txt>; rel="describedby"')
    expect(link).toContain('</sitemap.xml>; rel="sitemap"')
    expect(link).toContain('</tutorial.md>; rel="alternate"; type="text/markdown"')
  })
})

test.describe('what a crawler gets', () => {
  for (const route of ROUTES) {
    test(`${route} is a complete page without JavaScript`, async ({ request }) => {
      const res = await get(request, route, { 'User-Agent': AI_AGENTS.GPTBot })
      expect(res.status()).toBe(200)
      const html = await res.text()

      expect(attr(html, 'link', 'rel', 'canonical', 'href')).toBe(CANONICAL + route)
      expect(attr(html, 'meta', 'name', 'robots', 'content')).not.toContain('noindex')
      expect(html.match(/<title>([^<]*)<\/title>/)?.[1]?.length ?? 0, 'has a title').toBeGreaterThan(10)
      expect(attr(html, 'meta', 'name', 'description', 'content')?.length ?? 0, 'has a description').toBeGreaterThan(20)

      const main = mainOf(html)
      const h1 = headingsOf(main, 1)
      expect(h1, 'one main heading').toHaveLength(1)
      expect(h1[0], 'the heading is the page\'s, not a placeholder').not.toMatch(/loading/i)
      expect(textOf(main).split(' ').length, 'the page\'s text is in the HTML').toBeGreaterThan(20)

      // Structured data that parses, and names this page.
      const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]))
      const things = blocks.flatMap((b) => b['@graph'] ?? [b])
      expect(things.find((t) => t['@type'] === 'WebPage')?.url).toBe(CANONICAL + route)
    })
  }

  for (const course of COURSES) {
    test(`the lesson ${course.id} is in its page, text and code`, async ({ request }) => {
      const html = await (await get(request, `/courses/${course.id}`)).text()
      const main = mainOf(html)
      expect(headingsOf(main, 1)).toEqual([course.title])
      expect(headingsOf(main, 2)).toContain(lessonHeading(course.id))
      expect(main, 'the code example').toContain('<pre>')
      expect(textOf(main).split(' ').length, 'the whole lesson, not a summary').toBeGreaterThan(200)
      const things = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => JSON.parse(m[1])['@graph'])
      expect(things.find((t) => t['@type'] === 'LearningResource')?.name).toBe(course.title)
    })
  }

  test('every page has its own title and description', async ({ request }) => {
    const seen = { title: new Map<string, string>(), description: new Map<string, string>() }
    for (const route of ROUTES) {
      const html = await (await get(request, route)).text()
      const title = html.match(/<title>([^<]*)<\/title>/)![1]
      const description = attr(html, 'meta', 'name', 'description', 'content')!
      expect(seen.title.get(title), `${route} shares its title "${title}"`).toBeUndefined()
      expect(seen.description.get(description), `${route} shares its description`).toBeUndefined()
      seen.title.set(title, route)
      seen.description.set(description, route)
    }
  })

  test('every page can be reached by following links from the home page, and no link is broken', async ({ request }) => {
    const found = new Set(['/'])
    const queue = ['/']
    const from = new Map<string, string>()
    while (queue.length) {
      const here = queue.shift()!
      const res = await get(request, here)
      expect(res.status(), `${here} (linked from ${from.get(here) ?? 'nowhere'})`).toBeLessThan(400)
      if (!ROUTES.includes(here)) continue // only the public pages are read for more links
      for (const href of linksOf(await res.text())) {
        if (!href.startsWith('/') || found.has(href)) continue
        found.add(href)
        from.set(href, here)
        queue.push(href)
      }
    }
    for (const route of ROUTES) expect([...found], `${route} is linked from another page`).toContain(route)
  })

  test('AI crawlers and agents get the page everyone else gets', async ({ request }) => {
    const plain = await (await get(request, '/tutorial')).text()
    for (const [name, userAgent] of Object.entries(AI_AGENTS)) {
      const res = await get(request, '/tutorial', { 'User-Agent': userAgent })
      expect(res.status(), name).toBe(200)
      expect(textOf(mainOf(await res.text())), name).toBe(textOf(mainOf(plain)))
    }
  })

  test('an address that does not exist is a 404, and a page has one address', async ({ request }) => {
    const missing = await get(request, '/no-such-page')
    expect(missing.status()).toBe(404)
    expect(attr(await missing.text(), 'meta', 'name', 'robots', 'content')).toContain('noindex')
    expect((await get(request, '/courses/no-such-lesson.md')).status()).toBe(404)
    const slash = await get(request, '/tutorial/')
    expect(slash.status()).toBe(301)
    expect(slash.headers()['location']).toBe('/tutorial')
  })
})

test.describe('Markdown for language models', () => {
  for (const route of ROUTES) {
    test(`${route} is also served as Markdown`, async ({ request }) => {
      const html = await (await get(request, route)).text()
      expect(attr(html, 'link', 'type', 'text/markdown', 'href'), 'the page points to it').toBe(mdFor(route))

      const res = await get(request, mdFor(route))
      expect(res.status()).toBe(200)
      expect(res.headers()['content-type']).toBe('text/markdown; charset=utf-8')
      expect(res.headers()['link'], 'the page is the address to index').toContain(`<${CANONICAL}${route}>; rel="canonical"`)
      const markdown = await res.text()
      expect(markdown).toMatch(new RegExp(`^---\\ntitle: .+\\ndescription: .+\\nurl: ${CANONICAL}${route}\\n---\\n`))
      expect(markdown, 'no markup left over').not.toMatch(/<(div|span|section|button)\b/)
      // The same words as the page, give or take its controls.
      const heading = headingsOf(mainOf(html), 1)[0]
      expect(markdown.replace(/[*_\\]/g, '').replace(/\s+/g, ' ')).toContain(heading.replace(/\s+/g, ' '))
      expect(markdown.split(/\s+/).length).toBeGreaterThan(40)

      // …and at the page's own address, to a client that asks for Markdown.
      const negotiated = await get(request, route, { Accept: 'text/markdown' })
      expect(negotiated.headers()['content-type']).toBe('text/markdown; charset=utf-8')
      expect(await negotiated.text()).toBe(markdown)
      expect((await get(request, route, { Accept: 'text/html,*/*;q=0.8' })).headers()['content-type']).toContain('text/html')
    })
  }

  test('llms.txt is a guide whose links all work', async ({ request }) => {
    const res = await get(request, '/llms.txt')
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toBe('text/plain; charset=utf-8')
    const guide = await res.text()
    expect(guide).toMatch(/^# VortexML\n\n> /)
    const links = [...guide.matchAll(/\]\((https:\/\/vortexml\.ro[^)]*)\)/g)].map((m) => m[1].slice(CANONICAL.length) || '/')
    expect(links.length).toBeGreaterThan(20)
    for (const link of links) expect((await get(request, link)).status(), link).toBe(200)
    for (const course of COURSES) expect(links, `the lesson ${course.id}`).toContain(`/courses/${course.id}.md`)
  })

  test('llms-full.txt carries the guide, the tutorial and every lesson', async ({ request }) => {
    const res = await get(request, '/llms-full.txt')
    expect(res.headers()['content-type']).toBe('text/plain; charset=utf-8')
    const full = await res.text()
    expect(full).toContain('## The tutorial')
    for (const course of COURSES) expect(full, course.id).toContain(`# ${lessonHeading(course.id)}`)
  })
})

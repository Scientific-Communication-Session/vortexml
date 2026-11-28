#!/usr/bin/env node
/**
 * Last step of `npm run build`: writes every public page out as static HTML.
 *
 * The app is a single-page application, so without this a crawler, a link
 * checker or a language model fetching /privacy would get an empty shell. Here
 * each route in public/sitemap.xml is rendered once on the build machine (by
 * dist-ssr/entry-server.js, the same React tree the browser runs) and saved as
 * dist/<route>.html with that page's own title, description and canonical URL.
 * The browser then hydrates the markup instead of drawing it from nothing.
 *
 * Pages that show data from the API are rendered with that data: the lessons
 * are read from backend/courses/ (the files the API serves), so /courses and
 * every /courses/<id> come out with their text, not a "Loading…" placeholder.
 *
 * Next to each page goes a Markdown twin, dist/<route>.md, for language models
 * and agents: the same content without the markup. The server hands it out at
 * <route>.md and to requests that ask for `Accept: text/markdown`.
 *
 * dist/index.html is left as the empty shell: routes that are not prerendered
 * (/profile, /survey) start from it. The home page is dist/_home.html and
 * unknown addresses get dist/404.html; vite.config.ts maps both.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

// Load the production build of React, like the browser does.
process.env.NODE_ENV = 'production';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

const { render, metaFor } = await import(pathToFileURL(path.join(ROOT, 'dist-ssr/entry-server.js')).href);
const template = read(DIST, 'index.html');
const manifest = JSON.parse(read(DIST, '.vite/manifest.json'));

// ── Which pages exist ───────────────────────────────────────────────────────
// Prerendered: everything in the sitemap (and every lesson). Known to the app: every <Route> in
// App.tsx, which is also where each route's page module is named.
const sitemap = [...read(ROOT, 'public/sitemap.xml').matchAll(/<loc>https?:\/\/[^/]+([^<]*)<\/loc>/g)].map((m) => m[1] || '/');
const appSource = read(ROOT, 'src/App.tsx');
const pageModule = Object.fromEntries(
    [...appSource.matchAll(/const (\w+) = lazy\(\(\) => import\('\.\/([^']+)'\)\)/g)].map((m) => [m[1], `src/${m[2]}.tsx`]),
);
const appRoutes = [
    ...[...appSource.matchAll(/<Route path="([^"*/][^"]*)" element=\{<(\w+) \/>\}/g)].map((m) => ({ path: `/${m[1]}`, component: m[2] })),
    ...[...appSource.matchAll(/<Route index element=\{<(\w+) \/>\}/g)].map((m) => ({ path: '/', component: m[1] })),
];
if (appRoutes.length < 2) throw new Error('prerender: could not read the routes from src/App.tsx');

const routePattern = (r) => new RegExp(`^${r.path.replace(/:[^/]+/g, '[^/]+')}$`);
const componentFor = (route) => appRoutes.find((r) => routePattern(r).test(route))?.component;

// ── The data some pages are built with ──────────────────────────────────────
// The lessons, exactly as GET /api/courses and /api/courses/<id> answer them
// (backend/app.py reads the same files).
const COURSES_DIR = path.join(ROOT, '..', 'backend', 'courses');
const courses = JSON.parse(read(COURSES_DIR, 'index.json')).map((c) => ({ ...c, content: read(COURSES_DIR, `${c.id}.md`) }));
const courseList = courses.map(({ content: _content, ...summary }) => summary);
const courseAt = (route) => courses.find((c) => route === `/courses/${c.id}`);

/** What the page at `route` would fetch, keyed by API address (src/preloaded.ts). */
const dataFor = (route) => {
    const course = courseAt(route);
    if (course) return { [`/api/courses/${course.id}`]: course };
    // (/learn shows the course list in its second tab.)
    if (route === '/courses' || route === '/learn') return { '/api/courses': courseList };
    return {};
};

const routes = [...sitemap];
for (const c of courses) {
    if (routes.includes(`/courses/${c.id}`)) continue;
    console.warn(`prerender: /courses/${c.id} is not in public/sitemap.xml — add it so search engines find the lesson`);
    routes.push(`/courses/${c.id}`);
}

// ── Building one page ───────────────────────────────────────────────────────
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Replace the value of one head tag, or fail loudly if index.html no longer has it. */
const setTag = (html, pattern, value) => {
    if (!pattern.test(html)) throw new Error(`prerender: index.html has no tag matching ${pattern}`);
    return html.replace(pattern, (_, before, after) => before + esc(value) + after);
};

/** <link rel="modulepreload"> for a page's own chunk and what it imports, so they load alongside the entry script. */
const preloads = (component) => {
    const files = new Set();
    const visit = (key) => {
        const chunk = manifest[key];
        if (!chunk || chunk.isEntry || files.has(chunk.file)) return;
        files.add(chunk.file);
        (chunk.imports ?? []).forEach(visit);
    };
    if (pageModule[component]) visit(pageModule[component]);
    return [...files].map((f) => `    <link rel="modulepreload" crossorigin href="/${f}" />\n`).join('');
};

/** JSON inside a <script> block: nothing in it may read as markup. */
const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

const SITE_URL = metaFor('/').url.replace(/\/$/, '');
const absolute = (href) => (href.startsWith('/') ? SITE_URL + href : href);

/** schema.org description of one page: what it is and where it sits in the site. */
const structuredData = (route, meta) => {
    const crumbs = [{ name: 'Home', url: `${SITE_URL}/` }];
    const course = courseAt(route);
    if (course) crumbs.push({ name: 'Courses', url: `${SITE_URL}/courses` });
    if (route !== '/') crumbs.push({ name: course?.title ?? meta.title.split(' · ')[0].split(' — ')[0], url: meta.url });
    const graph = [
        {
            '@type': 'WebPage',
            '@id': `${meta.url}#page`,
            url: meta.url,
            name: meta.title,
            description: meta.description,
            inLanguage: 'en',
            isPartOf: { '@id': `${SITE_URL}/#website` },
        },
    ];
    if (crumbs.length > 1) {
        graph.push({
            '@type': 'BreadcrumbList',
            itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.url })),
        });
    }
    const lesson = (c) => ({
        '@type': 'LearningResource',
        '@id': `${SITE_URL}/courses/${c.id}#lesson`,
        url: `${SITE_URL}/courses/${c.id}`,
        name: c.title,
        description: c.description,
        learningResourceType: 'Lesson',
        educationalUse: 'Self-study',
        timeRequired: `PT${parseInt(c.duration, 10)}M`,
        keywords: c.tags.join(', '),
        inLanguage: 'en',
        isAccessibleForFree: true,
        publisher: { '@id': `${SITE_URL}/#org` },
    });
    if (course) graph.push(lesson(course));
    if (route === '/courses') {
        graph.push({
            '@type': 'ItemList',
            name: 'VortexML courses',
            itemListElement: courses.map((c, i) => ({ '@type': 'ListItem', position: i + 1, item: lesson(c) })),
        });
    }
    return { '@context': 'https://schema.org', '@graph': graph };
};

const mdFor = (route) => (route === '/' ? '/index.md' : `${route}.md`);

const page = (route, body, { noindex = false } = {}) => {
    const meta = metaFor(route);
    const data = dataFor(route);
    let html = template;
    html = setTag(html, /(<title>)[^<]*(<\/title>)/, meta.title);
    html = setTag(html, /(<meta\s+name="description"\s+content=")[^"]*(")/, meta.description);
    html = setTag(html, /(<link\s+rel="canonical"\s+href=")[^"]*(")/, meta.url);
    html = setTag(html, /(<meta\s+property="og:url"\s+content=")[^"]*(")/, meta.url);
    html = setTag(html, /(<meta\s+property="og:title"\s+content=")[^"]*(")/, meta.ogTitle);
    html = setTag(html, /(<meta\s+property="og:description"\s+content=")[^"]*(")/, meta.description);
    html = setTag(html, /(<meta\s+name="twitter:title"\s+content=")[^"]*(")/, meta.ogTitle);
    html = setTag(html, /(<meta\s+name="twitter:description"\s+content=")[^"]*(")/, meta.description);
    let head = preloads(componentFor(route));
    if (noindex) {
        html = setTag(html, /(<meta\s+name="robots"\s+content=")[^"]*(")/, 'noindex');
    } else {
        head += `    <link rel="alternate" type="text/markdown" href="${mdFor(route)}" title="This page as Markdown" />\n`;
        head += `    <script type="application/ld+json">${json(structuredData(route, meta))}</script>\n`;
    }
    html = html.replace('</head>', () => `${head}  </head>`);
    if (!html.includes('<div id="root"></div>')) throw new Error('prerender: index.html has no empty #root');
    // The data the page was rendered with, for the browser's first render (not
    // a script that runs: the content security policy has nothing to object to).
    const embedded = Object.keys(data).length ? `\n    <script type="application/json" id="vx-data">${json(data)}</script>` : '';
    // (A function, so `$` in a lesson's formulas is not read as a replacement pattern.)
    return html.replace('<div id="root"></div>', () => `<div id="root">${body}</div>${embedded}`);
};

// ── The Markdown twin of a page ─────────────────────────────────────────────
const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });
turndown.use(gfm);
// Not content. (Buttons stay, as their label: some hold a step's whole text.)
turndown.remove(['script', 'style', 'svg', 'noscript']);
turndown.remove((node) => node.getAttribute?.('aria-hidden') === 'true');
turndown.addRule('recording', {
    filter: 'video',
    replacement: (_content, node) => `\n\n[Recording: ${node.getAttribute('aria-label') || 'screen recording'}](${absolute(node.getAttribute('src') || '')})\n\n`,
});
turndown.addRule('absoluteLink', {
    filter: (node) => node.nodeName === 'A' && node.getAttribute('href'),
    replacement: (content, node) => {
        const href = absolute(node.getAttribute('href'));
        // A card that is one big link: its heading becomes the link, the rest follows it.
        const heading = content.match(/^(#{1,6}) (.+)$/m);
        if (heading) {
            const rest = content.replace(heading[0], '').replace(/\s*\n\s*/g, ' ').trim();
            return `\n\n${heading[1]} [${heading[2]}](${href})\n\n${rest}\n\n`;
        }
        const text = content.replace(/\s*\n\s*/g, ' ').trim();
        return text ? `[${text}](${href})` : '';
    },
});
// A table without a header row (GitHub-flavoured Markdown needs one).
// (The converter's own DOM has plain indexed collections, hence `items`.)
const items = (collection) => Array.from({ length: collection.length }, (_, i) => collection[i]);
turndown.addRule('plainTable', {
    filter: (node) => node.nodeName === 'TABLE' && !node.getElementsByTagName('th').length,
    replacement: (_content, node) => {
        const cell = (c) => c.textContent.replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
        const rows = items(node.getElementsByTagName('tr')).map((tr) => items(tr.children).map(cell));
        const width = Math.max(0, ...rows.map((r) => r.length));
        if (!width) return '';
        const line = (cells) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
        return `\n\n${[line([]), line(Array(width).fill('---')), ...rows.map(line)].join('\n')}\n\n`;
    },
});

/** Labels set side by side by the stylesheet have no space between them in the markup: add one. */
const spaced = (html) => html
    .replace(/<svg\b[\s\S]*?<\/svg>/g, '')
    .split(/(<pre[\s\S]*?<\/pre>)/)
    .map((part, i) => (i % 2 ? part : part.replace(/(<\/(?:span|a|button|em|strong|b|i|small|kbd|code|p|div|h[1-6])>)(?=<(?:span|a|button|em|strong|b|i|small|kbd|code)\b)/g, '$1 ')))
    .join('');

const frontMatter = (meta) => `---\ntitle: ${JSON.stringify(meta.title)}\ndescription: ${JSON.stringify(meta.description)}\nurl: ${meta.url}\n---\n\n`;
const MD_FOOTER = `\n\n---\n\nA guide to this site for language models and agents: ${SITE_URL}/llms.txt\n`;

const markdown = (route, body) => {
    const meta = metaFor(route);
    const course = courseAt(route);
    if (course) {
        // The lesson is written in Markdown: pass it on as it is, formulas included.
        return `${frontMatter(meta)}${course.content.trim()}\n\n---\n\n${course.description} `
            + `${course.duration} · ${course.tags.join(', ')} · [All courses](${SITE_URL}/courses)${MD_FOOTER}`;
    }
    const main = body.match(/<main\b[^>]*>([\s\S]*)<\/main>/);
    if (!main) throw new Error(`prerender: ${route} has no <main>`);
    return frontMatter(meta) + turndown.turndown(spaced(main[1])).replace(/\n{3,}/g, '\n\n') + MD_FOOTER;
};

const fileFor = (route) => (route === '/' ? '_home.html' : `${route.slice(1)}.html`);

// ── Render ──────────────────────────────────────────────────────────────────
let failed = 0;
const written = new Set([path.join(DIST, 'index.html')]);
for (const route of [...routes, '/404']) {
    const file = path.join(DIST, route === '/404' ? '404.html' : fileFor(route));
    const twin = route === '/404' ? undefined : path.join(DIST, mdFor(route));
    try {
        // (render() leaves the page's data in place, so page() and markdown() see the lesson's own title.)
        const body = await render(route, dataFor(route));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, page(route, body, { noindex: route === '/404' }));
        written.add(file);
        if (twin) {
            fs.writeFileSync(twin, markdown(route, body));
            written.add(twin);
        }
    } catch (err) {
        // A page that cannot be rendered here still works: the browser draws it
        // from the shell. Remove any stale copy and carry on.
        failed += 1;
        fs.rmSync(file, { force: true });
        if (twin) fs.rmSync(twin, { force: true });
        console.warn(`prerender: ${route} skipped — ${err?.message ?? err}`);
    }
}

// The one-file version for language models: the hand-written guide from
// public/, followed by every lesson in full.
fs.writeFileSync(path.join(DIST, 'llms-full.txt'), [
    read(ROOT, 'public/llms-full.txt').trimEnd(),
    '\n\n## The courses, in full\n',
    ...courses.map((c) => `\n---\n\nLesson: ${c.title} (${SITE_URL}/courses/${c.id}) · ${c.duration} · ${c.tags.join(', ')}\n\n${c.content.trim()}\n`),
].join(''));

// The server answers 404 for page addresses that match none of these.
fs.writeFileSync(path.join(DIST, 'routes.json'), JSON.stringify(appRoutes.map((r) => r.path)));

// ── Prune ───────────────────────────────────────────────────────────────────
// Builds do not empty dist/ (open tabs may still ask for the previous build's
// chunks). Drop the pages of routes that have left the sitemap, and hashed
// files that this build does not use once they are a week old.
for (const name of fs.readdirSync(DIST, { recursive: true })) {
    const file = path.join(DIST, name);
    // (A file of public/, such as a site-verification page, is not ours to remove.)
    const ours = /\.(html|md)$/.test(name) && !fs.existsSync(path.join(ROOT, 'public', name));
    if (ours && !written.has(file)) fs.rmSync(file);
}
const current = new Set(Object.values(manifest).flatMap((c) => [c.file, ...(c.css ?? []), ...(c.assets ?? [])]));
const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
let pruned = 0;
for (const name of fs.readdirSync(path.join(DIST, 'assets'))) {
    const file = path.join(DIST, 'assets', name);
    if (!current.has(`assets/${name}`) && fs.statSync(file).mtimeMs < weekAgo) {
        fs.rmSync(file);
        pruned += 1;
    }
}

console.log(`prerender: ${routes.length + 1 - failed} pages written${failed ? `, ${failed} skipped` : ''}${pruned ? `, ${pruned} old files pruned` : ''}`);
// The React tree keeps timers alive (polling, sockets): leave explicitly.
process.exit(failed === routes.length + 1 ? 1 : 0);

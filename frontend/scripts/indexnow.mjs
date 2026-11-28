#!/usr/bin/env node
/**
 * Tells search engines which pages exist or have changed: `npm run indexnow`.
 *
 * IndexNow (indexnow.org) is how Bing, Yandex, Seznam and Naver take page
 * addresses from a site instead of waiting to come across them; Bing's index
 * is also what several AI assistants search. Run this after publishing a new
 * page or a change worth re-reading. It sends the addresses in
 * public/sitemap.xml and nothing else.
 *
 * The key proves the sender controls the site: it is the name and the content
 * of a text file in public/, so it is public by design. Google does not take
 * part: there, add the site in Search Console and submit the sitemap.
 */
import fs from 'node:fs';
import path from 'node:path';

const PUBLIC = path.resolve(import.meta.dirname, '../public');
const urls = [...fs.readFileSync(path.join(PUBLIC, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const host = new URL(urls[0]).host;

// The key file: <key>.txt whose content is its own name.
const key = fs.readdirSync(PUBLIC)
    .map((name) => name.match(/^([0-9a-f]{32})\.txt$/)?.[1])
    .find((k) => k && fs.readFileSync(path.join(PUBLIC, `${k}.txt`), 'utf8').trim() === k);
if (!key) {
    console.error('indexnow: no key file in public/ (a file named <32 hex characters>.txt containing those characters)');
    process.exit(1);
}

// The engines fetch the key file to check it: it has to be live first.
const keyLocation = `https://${host}/${key}.txt`;
const served = await fetch(keyLocation).then((r) => (r.ok ? r.text() : ''), () => '');
if (served.trim() !== key) {
    console.error(`indexnow: ${keyLocation} is not live yet — build and publish first`);
    process.exit(1);
}

const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host, key, keyLocation, urlList: urls }),
});
console.log(`indexnow: ${urls.length} addresses sent, answer ${res.status} ${res.statusText}`);
process.exit(res.ok ? 0 : 1);

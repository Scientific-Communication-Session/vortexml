#!/usr/bin/env node
/**
 * Fetches the Cabinet Grotesk font files from Fontshare, if they are missing.
 * Runs before `npm run dev` and `npm run build`.
 *
 * The site serves its typefaces itself (src/styles/fonts.css), so no visitor's
 * address goes to a font host. Cabinet Grotesk's licence (ITF Free Font
 * License, fontshare.com/licenses/itf-ffl) allows exactly that, but not passing
 * the files on, "through a repository" included: everyone gets their own copy
 * from Fontshare. So the four files are not in git (see .gitignore) and each
 * checkout downloads them once. JetBrains Mono is under the Open Font License
 * and is in the repository.
 */
import fs from 'node:fs';
import path from 'node:path';

const FAMILY = 'cabinet-grotesk';
const NAME = 'Cabinet Grotesk';
const WEIGHTS = [400, 500, 700, 800];
const DIR = path.resolve(import.meta.dirname, '../src/assets/fonts');
const fileFor = (weight) => path.join(DIR, `${FAMILY}-${weight}.woff2`);

const missing = WEIGHTS.filter((w) => !fs.existsSync(fileFor(w)));
if (!missing.length) process.exit(0);

try {
    // Fontshare's stylesheet for the family names the current file of each
    // weight. (It can list other families after the one asked for: keep ours.)
    const css = await (await fetch(`https://api.fontshare.com/v2/css?f[]=${FAMILY}@${WEIGHTS.join(',')}&display=swap`)).text();
    const faces = Object.fromEntries(
        [...css.matchAll(/@font-face\s*{[^}]*}/g)]
            .filter(([face]) => face.includes(`font-family: '${NAME}'`))
            .map(([face]) => [
                Number(face.match(/font-weight:\s*(\d+)/)?.[1]),
                face.match(/url\('([^']+\.woff2)'\)/)?.[1],
            ]),
    );
    fs.mkdirSync(DIR, { recursive: true });
    for (const weight of missing) {
        if (!faces[weight]) throw new Error(`Fontshare's stylesheet has no weight ${weight}`);
        const res = await fetch(new URL(faces[weight], 'https://cdn.fontshare.com'));
        if (!res.ok) throw new Error(`weight ${weight}: HTTP ${res.status}`);
        const bytes = Buffer.from(await res.arrayBuffer());
        // Every WOFF2 file starts with "wOF2": do not save an error page as a font.
        if (bytes.subarray(0, 4).toString('latin1') !== 'wOF2') throw new Error(`weight ${weight}: not a WOFF2 file`);
        fs.writeFileSync(fileFor(weight), bytes);
    }
    console.log(`fonts: fetched Cabinet Grotesk ${missing.join(', ')} from Fontshare`);
} catch (err) {
    console.error(`fonts: could not fetch Cabinet Grotesk (${err?.message ?? err}).`);
    console.error('       Download the family from https://www.fontshare.com/fonts/cabinet-grotesk and put the');
    console.error(`       WOFF2 files in ${path.relative(process.cwd(), DIR)}/ as ${FAMILY}-<weight>.woff2 (${WEIGHTS.join(', ')}).`);
    process.exit(1);
}

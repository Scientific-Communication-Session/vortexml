// Data a page was built with.
//
// The public pages are written out as static HTML at build time
// (scripts/prerender.mjs). A page that shows data from the API — the course
// list, a lesson — is rendered with that data, and the data is embedded in the
// page as JSON (`<script type="application/json" id="vx-data">`), keyed by the
// API address it stands for. The browser's first render reads it from there, so
// it draws the same page the build did instead of a "Loading…" placeholder.

type Store = Record<string, unknown>;

let store: Store | undefined;

/** Build time only: the data the next page is rendered with. */
export function setPreloaded(data: Store) {
    store = data;
}

/** What `GET url` answered when this page was built, if the page was built with it. */
export function preloaded<T>(url: string): T | undefined {
    if (!store) {
        store = {};
        if (typeof document !== 'undefined') {
            try {
                store = JSON.parse(document.getElementById('vx-data')?.textContent || '{}');
            } catch {
                // A damaged block only costs the head start: the page fetches as usual.
            }
        }
    }
    return store![url] as T | undefined;
}

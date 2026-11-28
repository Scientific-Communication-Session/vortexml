import { StrictMode } from 'react'
import { prerender } from 'react-dom/static'
import { StaticRouter } from 'react-router-dom'
import App from './App.tsx'
import { setPreloaded } from './preloaded'

export { metaFor } from './pageMeta'

/**
 * One route as static HTML, with its lazy page loaded. Runs at build time only
 * (scripts/prerender.mjs); the tree must match main.tsx so the browser can
 * hydrate it.
 *
 * `data` is what the page would otherwise fetch, keyed by API address (see
 * preloaded.ts). It stays in place after the call, so `metaFor(url)` answers
 * with it too.
 */
export async function render(url: string, data: Record<string, unknown> = {}): Promise<string> {
  setPreloaded(data)
  // React carries on past an error inside a Suspense boundary and leaves that
  // part for the browser. A page with a hole is not worth saving: fail it.
  const errors: unknown[] = []
  const { prelude } = await prerender(
    <StrictMode>
      <StaticRouter location={url}>
        <App />
      </StaticRouter>
    </StrictMode>,
    {
      onError: (error) => { errors.push(error) },
      // Write every page as one plain document. Past this size React would park
      // the content in a hidden block and move it in with an inline script,
      // which readers without JavaScript never see and our CSP forbids.
      progressiveChunkSize: Number.MAX_SAFE_INTEGER,
    },
  )
  const html = await new Response(prelude).text()
  if (errors.length) throw errors[0]
  return html
}

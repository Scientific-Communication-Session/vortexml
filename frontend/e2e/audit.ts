// What a browser-driving agent has to work with on a page.
//
// Agents that operate a browser (through Playwright, or an accessibility API)
// do not look at pixels first: they read the accessibility tree — roles and
// names — and act on it. A control without a name, or a clickable <div> that is
// not a control at all, is something they cannot find or cannot press.
import type { Page } from '@playwright/test'

const CONTROLS = 'button|link|textbox|searchbox|checkbox|radio|combobox|listbox|slider|spinbutton|switch|tab|menuitem'

/** The problems on the page as it is now; empty when there are none. */
export async function audit(page: Page): Promise<string[]> {
  const problems: string[] = []

  // Controls and images in the accessibility tree that have no name. (A named
  // one is printed as `- button "Start Training"`.)
  const tree = await page.locator('body').ariaSnapshot()
  for (const line of tree.split('\n')) {
    if (new RegExp(`^\\s*- (${CONTROLS}|img)(?=$|:| \\[)`).test(line)) problems.push(`no name: ${line.trim()}`)
  }

  // Things that look clickable (a pointer cursor) but are neither a control nor
  // hold one. A card or row that reacts to a click anywhere on it carries a
  // `.btn-text` button as its real control (see styles/app.css).
  problems.push(...await page.evaluate(() => {
    const CONTROL = 'a[href], button, input, select, textarea, label, summary, [role=button], [role=link], [role=tab], [role=radio], [role=checkbox], [role=switch], [role=menuitem], [role=option]'
    const pointer = (el: Element) => getComputedStyle(el).cursor === 'pointer'
    const found: string[] = []
    for (const el of document.querySelectorAll('body *')) {
      if (!pointer(el) || el.closest(CONTROL) || el.querySelector('.btn-text')) continue
      if (el.parentElement && pointer(el.parentElement) && !el.parentElement.closest(CONTROL)) continue // its parent is reported
      const box = el.getBoundingClientRect()
      if (!box.width || !box.height) continue
      found.push(`clickable, but not a control: <${el.tagName.toLowerCase()} class="${el.getAttribute('class') ?? ''}"> ${(el.textContent ?? '').trim().slice(0, 50)}`)
    }
    return found
  }))

  // The page's skeleton: where the content is, what it is called.
  const skeleton = await page.evaluate(() => ({
    main: document.querySelectorAll('main').length,
    nav: document.querySelectorAll('nav').length,
    h1: document.querySelectorAll('main h1').length,
  }))
  if (skeleton.main !== 1) problems.push(`${skeleton.main} <main> regions (want 1)`)
  if (skeleton.nav < 1) problems.push('no <nav>')
  if (skeleton.h1 !== 1) problems.push(`${skeleton.h1} main headings (want 1)`)

  return problems
}

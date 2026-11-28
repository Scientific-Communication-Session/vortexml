// The site in a browser that runs no JavaScript: what a screenshot-taking
// crawler, a reader mode or a cautious visitor gets. The pages are prerendered,
// so they should be readable and their links should work. Read-only.
import { expect, test } from '@playwright/test'
import { COURSES } from './site.ts'

test.use({ javaScriptEnabled: false })

for (const route of ['/', '/tutorial', '/learn', '/courses', `/courses/${COURSES[0].id}`, '/about']) {
  test(`${route} is readable`, async ({ page }) => {
    await page.goto(route)
    await expect(page.locator('main h1')).toBeVisible()

    // Nothing is left invisible, waiting for a script to fade it in. (The
    // entrance animations that are plain CSS get a moment to finish.)
    await expect.poll(() => page.evaluate(() => {
      const opacity = (el: Element | null): number => (el ? Number(getComputedStyle(el).opacity) * opacity(el.parentElement) : 1)
      return [...document.querySelectorAll('main h1, main h2, main h3, main p, main li')]
        .filter((el) => (el.textContent ?? '').trim() && !el.closest('[aria-hidden=true], .sr-only') && opacity(el) < 0.5)
        .map((el) => (el.textContent ?? '').trim().slice(0, 60))
    }), { message: 'text that cannot be seen', timeout: 5000 }).toEqual([])
  })
}

test('links work: from the course list into a lesson and back', async ({ page }) => {
  await page.goto('/courses')
  await page.getByRole('link', { name: new RegExp(COURSES[0].title) }).click()
  await expect(page).toHaveURL(new RegExp(`/courses/${COURSES[0].id}$`))
  await expect(page.locator('main h1')).toHaveText(COURSES[0].title)
  await page.getByRole('link', { name: 'All courses' }).click()
  await expect(page).toHaveURL(/\/courses$/)
})

test('the footer leads to every section', async ({ page }) => {
  await page.goto('/')
  const footer = page.getByRole('contentinfo')
  for (const name of ['Tutorial', 'Live Demo', 'Privacy Policy', 'Terms']) {
    await expect(footer.getByRole('link', { name, exact: true }).first()).toBeVisible()
  }
})

// The site as a browser-driving agent meets it: a real browser, operated only
// through the accessibility tree — roles and names, never CSS classes.
//
// The first half checks every public page and is read-only. The second half is
// a journey — sign up, load data, train a model, use it, delete the account —
// and runs only against a local copy (or with AGENT_JOURNEY=1), since it
// creates an account and a training run.
import { expect, test, type Page } from '@playwright/test'
import { audit } from './audit.ts'
import { COURSES, ROUTES } from './site.ts'

const settled = (page: Page) => page.waitForLoadState('networkidle')

test.describe('every public page can be operated by role and name', () => {
  for (const route of ROUTES) {
    test(route, async ({ page }) => {
      await page.goto(route)
      await settled(page)
      expect(await audit(page)).toEqual([])
    })
  }
})

test.describe('finding the way around', () => {
  test('the menus in the top bar open and lead to their pages', async ({ page }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await nav.getByRole('button', { name: 'Build' }).click()
    await nav.getByRole('link', { name: /Architect/ }).click()
    await expect(page).toHaveURL(/\/architect$/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Architecture')

    await nav.getByRole('button', { name: 'Learn' }).click()
    await nav.getByRole('link', { name: /Tutorial/ }).click()
    await expect(page).toHaveURL(/\/tutorial$/)
  })

  test('Learn: a roadmap topic opens its explanation, and the Courses tab lists the lessons', async ({ page }) => {
    await page.goto('/learn')
    const topic = page.getByRole('button', { name: 'Linear Algebra', exact: true })
    await expect(topic).toHaveAccessibleDescription(/backbone of ML/)
    await topic.click()
    const dialog = page.getByRole('dialog', { name: 'Linear Algebra' })
    await expect(dialog).toContainText('backbone of ML')
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden()

    await page.getByRole('tab', { name: 'Courses' }).click()
    await page.getByRole('link', { name: new RegExp(COURSES[1].title.replace(/[&()]/g, '.')) }).click()
    await expect(page).toHaveURL(new RegExp(`/courses/${COURSES[1].id}$`))
    await expect(page.getByRole('heading', { level: 1, name: COURSES[1].title })).toBeVisible()
  })

  test('a lesson opened directly shows its text at once, with its own title', async ({ page }) => {
    await page.route('**/api/courses/**', (route) => route.abort()) // the page must not depend on it
    await page.goto(`/courses/${COURSES[0].id}`)
    await expect(page).toHaveTitle(new RegExp(`^${COURSES[0].title} · VortexML$`))
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(COURSES[0].title)
    await expect(page.getByRole('main').locator('pre').first()).toBeVisible()
  })
})

test.describe('the journey: from nothing to a prediction', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(240_000)

  const tag = Date.now().toString(36)
  const account = { email: `agent-${tag}@example.com`, username: `agent-${tag}`, password: `pw-${tag}-A1` }

  test('sign up, train a model on a sample dataset, ask it a question, delete the account', async ({ page, baseURL }) => {
    const local = /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL ?? '')
    test.skip(!local && !process.env.AGENT_JOURNEY, 'creates an account and trains a model: runs against a local copy, or with AGENT_JOURNEY=1')

    const main = page.getByRole('main')
    const check = async (where: string) => { await settled(page); expect(await audit(page), where).toEqual([]) }

    await test.step('sign up', async () => {
      await page.goto('/')
      await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Sign Up' }).click()
      await main.getByRole('textbox', { name: 'Email' }).fill(account.email)
      await main.getByRole('textbox', { name: 'Username' }).fill(account.username)
      await main.getByRole('textbox', { name: 'Password' }).fill(account.password)
      await main.getByRole('textbox', { name: 'Confirm' }).fill(account.password)
      await main.getByRole('button', { name: 'Create account' }).click()
    })

    await test.step('answer the three questions', async () => {
      await expect(page).toHaveURL(/\/survey$/)
      await check('survey')
      for (const group of await main.getByRole('radiogroup').all()) await group.getByRole('radio').first().check()
      await main.getByRole('button', { name: 'Complete Registration' }).click()
      await expect(page).toHaveURL(/\/$/)
    })

    await test.step('load a sample dataset and choose the columns', async () => {
      const nav = page.getByRole('navigation', { name: 'Primary' })
      await nav.getByRole('button', { name: 'Build' }).click()
      await nav.getByRole('link', { name: /Dataset/ }).click()
      await main.getByRole('button', { name: /Student performance/ }).click()
      await expect(main.getByText('Data Preview')).toBeVisible()
      await check('dataset, loaded')
      for (const column of ['hours_studied', 'previous_score', 'attendance_rate', 'sleep_hours', 'assignments_done']) {
        const feature = main.getByRole('button', { name: `Feature: ${column}` })
        if (await feature.getAttribute('aria-pressed') !== 'true') await feature.click()
        await expect(feature).toHaveAttribute('aria-pressed', 'true')
      }
      const target = main.getByRole('button', { name: 'Target: passed' })
      if (await target.getAttribute('aria-pressed') !== 'true') await target.click()
      await expect(target).toHaveAttribute('aria-pressed', 'true')
      await main.getByRole('button', { name: /Continue to Architecture Builder/ }).click()
    })

    await test.step('design the network', async () => {
      await expect(page).toHaveURL(/\/architect$/)
      const mlp = main.getByRole('button', { name: 'Multi-Layer Perceptron', exact: true })
      await mlp.click()
      await expect(mlp).toHaveAttribute('aria-pressed', 'true')
      await main.getByRole('spinbutton', { name: 'Epochs' }).fill('20')
      await main.getByRole('combobox', { name: 'Batch Size' }).selectOption('32')
      await main.getByRole('textbox', { name: 'Project Name' }).fill('Agent-Model')
      await check('architect')
      await main.getByRole('button', { name: /Start Training/ }).click()
    })

    await test.step('train it', async () => {
      await expect(page).toHaveURL(/\/training$/)
      await check('training, before the run')
      await main.getByRole('button', { name: /Start Training/ }).click()
      await expect(main.getByText(/Final loss/)).toBeVisible({ timeout: 120_000 })
      await check('training, finished')
    })

    await test.step('ask the model a question', async () => {
      await page.goto('/predict')
      const models = main.getByRole('combobox', { name: 'Choose a model' })
      await models.selectOption({ label: (await models.getByRole('option', { name: /Agent-Model/ }).textContent())! })
      await main.getByRole('spinbutton', { name: 'hours_studied' }).fill('8')
      await main.getByRole('spinbutton', { name: 'previous_score' }).fill('82')
      await main.getByRole('spinbutton', { name: 'attendance_rate' }).fill('0.95')
      await main.getByRole('button', { name: 'Predict scenario' }).click()
      await expect(main.getByText(/Prediction/i).first()).toBeVisible()
      await check('predict')
    })

    await test.step('the other signed-in pages', async () => {
      for (const route of ['/leaderboard', '/assistant', '/chat', '/profile']) {
        await page.goto(route)
        await check(route)
      }
    })

    await test.step('delete the account', async () => {
      await page.goto('/profile')
      await main.getByRole('button', { name: /Delete account/i }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel(/password/i).fill(account.password)
      await dialog.getByRole('button', { name: /Delete/ }).click()
      await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Sign Up' })).toBeVisible()
    })
  })
})

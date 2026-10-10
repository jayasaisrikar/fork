import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const ENGINE = 'http://localhost:8791';
const SHOTS = 'test-results/screenshots';

async function signIn(page: Page) {
  await page.goto('/app');
  await page.getByLabel('Email').fill('cfo@kettleandpine.test');
  await page.getByLabel('Password').fill('correct horse');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Explore options' })).toBeVisible();
}

async function toAuthorized(page: Page) {
  await page.getByRole('button', { name: 'Explore options' }).click();
  await expect(page.getByRole('button', { name: /Preserve runway/ })).toContainText('$10,000');
  await page.getByRole('button', { name: /Preserve runway/ }).click();
  await page.getByRole('button', { name: 'Approve plan B' }).click();
  await page.getByRole('button', { name: 'Approve 6 payments' }).click();
  await expect(page.getByRole('button', { name: 'Execute plan B' })).toBeVisible();
}

async function shoot(page: Page, name: string) {
  for (const theme of ['dark', 'light'] as const) {
    const toggle = page.getByRole('button', { name: 'Toggle theme' });
    const current = await page.locator('[data-theme]').first().getAttribute('data-theme');
    if (current !== theme) await toggle.click();
    await expect(page.locator('[data-theme]').first()).toHaveAttribute('data-theme', theme);
    // let the color transitions finish so the picture is of one theme, not two
    await page.waitForTimeout(350);
    await page.screenshot({
      path: `${SHOTS}/${name}-${theme}-${page.viewportSize()!.width}.png`,
      fullPage: true,
    });
  }
  if ((await page.locator('[data-theme]').first().getAttribute('data-theme')) !== 'light') {
    await page.getByRole('button', { name: 'Toggle theme' }).click();
  }
}

test.beforeEach(async ({ request }) => {
  await request.get(`${ENGINE}/__reset`);
});

test('the core journey: explore, approve, tamper test, execute', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await signIn(page);
  await page.screenshot({ path: `${SHOTS}/studio-empty-light-1440.png` });

  // one click drafts the plans and runs the numbers on each
  await page.getByRole('button', { name: 'Explore options' }).click();
  await expect(page.getByRole('button', { name: /Share the shortfall/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('3 ways forward');
  const a = page.getByRole('button', { name: /Pay everything/ });
  await expect(a).toContainText('Rejected by FORK');
  await expect(a).toContainText('−$18,000');

  // FORK will not let the overdraft branch be authorized
  await a.click();
  await expect(page.getByRole('button', { name: "Can't approve plan A" })).toBeDisabled();
  await expect(page.getByText('Overdraws the account by $18,000.00.')).toBeVisible();

  await page.getByRole('button', { name: /Preserve runway/ }).click();
  await page.getByRole('button', { name: 'Approve plan B' }).click();
  await expect(page.getByRole('dialog')).toContainText('exactly these 6 payments');
  await expect(page.getByRole('dialog')).toContainText('$40,000.00');
  await page.getByRole('button', { name: 'Approve 6 payments' }).click();

  // the seal shows the same hash the API holds
  await expect(page.getByRole('button', { name: 'Execute plan B' })).toBeVisible();
  const run = await (await page.request.get(`${ENGINE}/api/runs/1`)).json();
  const hash: string = run.branches.find(
    (branch: { label: string }) => branch.label === 'B',
  ).approvedPlanHash;
  await expect(page.getByLabel(`Authorized, plan hash ${hash}`).first()).toBeVisible();
  await shoot(page, 'studio-approved');

  await page.getByRole('button', { name: 'Run tamper test' }).click();
  const calls = page.getByRole('list', { name: 'Activity' }).getByRole('listitem');
  await expect(page.getByText(/Blocked by ArmorIQ/).first()).toBeVisible();
  await expect(calls.filter({ hasText: 'update_vendor_destination' })).toContainText('BLOCK');
  await expect(
    calls.filter({ hasText: 'refused by the MCP' }).filter({ hasText: 'recipient-external-999' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Execute plan B' }).click();
  await expect(page.getByRole('button', { name: /Preserve runway/ })).toContainText('Completed', {
    timeout: 20_000,
  });
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Plan B is done.');
  await expect(page.getByText('$10,000').first()).toBeVisible();
  await expect(calls.filter({ hasText: 'execute_large_payment' })).toContainText('ALLOW');
  await shoot(page, 'studio-completed');

  // a reload lands on exactly the same state
  await page.reload();
  await expect(page.getByRole('button', { name: /Preserve runway/ })).toContainText('Completed');
  await expect(calls.filter({ hasText: 'execute_large_payment' })).toBeVisible();

  const axe = await new AxeBuilder({ page }).analyze();
  const serious = axe.violations
    .filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))
    .flatMap((violation) =>
      violation.nodes.map(
        (node) =>
          `${violation.id}: ${node.html.slice(0, 140)} | ${node.failureSummary?.split('\n')[1]?.trim().slice(0, 160)}`,
      ),
    );
  expect(serious).toEqual([]);
  expect(errors).toEqual([]);
});

test('a hostile message: the agent tries, ArmorIQ blocks, replan needs a new authorization', async ({
  page,
}) => {
  await signIn(page);
  await toAuthorized(page);

  await page.getByRole('button', { name: 'Inject hostile message' }).click();
  await expect(page.getByText('UNTRUSTED INPUT').first()).toBeVisible();
  await page.getByRole('button', { name: /Updated remittance details/ }).click();
  await expect(page.getByRole('dialog')).toContainText('recipient-external-999');
  await page.getByRole('button', { name: 'Close message' }).click();

  await page.getByRole('button', { name: 'Execute plan B' }).click();
  await expect(page.getByRole('button', { name: /Preserve runway/ })).toContainText(
    'Stopped early',
    { timeout: 20_000 },
  );
  const attempt = page
    .getByRole('list', { name: 'Activity' })
    .getByRole('listitem')
    .filter({ hasText: 'update_vendor_destination' });
  await expect(attempt).toContainText('Agent');
  await expect(attempt).toContainText('BLOCK');
  await expect(attempt).toContainText('IntentMismatchException');
  await shoot(page, 'studio-blocked');

  await page.getByRole('button', { name: 'Replan from here' }).click();
  const child = page.getByRole('button', { name: /B′/ });
  await expect(child).toContainText('Proposed');
  await expect(child).toContainText('Replan');
  // a new proposal is not an authorization
  await expect(page.getByRole('button', { name: 'Run the numbers' })).toBeVisible();
});

test('without ArmorIQ the app is usable and commit says why it is closed', async ({
  page,
  request,
}) => {
  await request.get(`${ENGINE}/__reset?armoriq=off`);
  await signIn(page);
  await toAuthorized(page).catch(() => undefined);
  const commit = page.getByRole('button', { name: 'Execute plan B' });
  await expect(commit).toBeDisabled();
  // the reason sits right under the button, no hover needed
  await expect(page.getByText(/Nothing can be committed/).first()).toBeVisible();
});

test('a phone can do the same job', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await toAuthorized(page);
  await expect(page.getByRole('list', { name: 'Plans' })).toBeVisible();
  await shoot(page, 'studio-approved');
  await page.getByRole('button', { name: 'Execute plan B' }).click();
  await expect(page.getByRole('button', { name: /Preserve runway/ })).toContainText('Completed', {
    timeout: 20_000,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('a finished decision can be followed by a new one, and the page moves to it', async ({
  page,
}) => {
  await signIn(page);
  await toAuthorized(page);
  await page.getByRole('button', { name: 'Execute plan B' }).click();
  await expect(page.getByRole('link', { name: 'View the receipt' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/Run #0001/)).toBeVisible();

  await page.getByRole('button', { name: 'Start a new decision' }).click();
  // the new run is on screen with its own plans, and the old one is in the history
  await expect(page.getByText(/Run #0002/)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('ways forward');
  await expect(page.getByRole('list', { name: 'Plans' }).getByRole('listitem')).toHaveCount(3);
  await expect(page.getByRole('button', { name: /Approve plan|Can't approve/ })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/studio-second-run-light-1440.png`, fullPage: true });

  await page.getByRole('link', { name: 'History', exact: true }).click();
  await expect(page.getByRole('link', { name: /Run #0001/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Run #0002/ })).toBeVisible();
});

test('the header is one row on a phone, with every link in the menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const header = page.getByRole('banner');
  expect((await header.boundingBox())!.height).toBeLessThanOrEqual(60);
  await page.getByRole('button', { name: 'Menu' }).click();
  const menu = page.getByRole('navigation', { name: 'Menu' });
  for (const name of ['Overview', 'How it works', 'Studio', 'History', 'Activity'])
    await expect(menu.getByRole('link', { name, exact: true })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/menu-light-390.png` });
  await menu.getByRole('link', { name: 'Studio', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
});

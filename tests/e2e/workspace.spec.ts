import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const ENGINE = 'http://localhost:8791';
const SHOTS = 'docs/screenshots';

async function signIn(page: Page) {
  await page.goto('/app');
  await page.getByLabel('Email').fill('cfo@kettleandpine.test');
  await page.getByLabel('Password').fill('correct horse');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Propose branches' }).first()).toBeVisible();
}

async function toAuthorized(page: Page) {
  await page.getByRole('button', { name: 'Propose branches' }).first().click();
  await expect(page.getByRole('button', { name: /Pay everything/ })).toBeVisible();
  await page.getByRole('button', { name: 'Simulate branches' }).click();
  await expect(page.getByRole('button', { name: /Preserve runway/ })).toContainText('$10,000');
  await page.getByRole('button', { name: /Preserve runway/ }).click();
  await page.getByRole('button', { name: 'Authorize branch B' }).first().click();
  await page.getByRole('button', { name: 'Authorize 6 payments' }).click();
  await expect(page.getByRole('button', { name: 'Commit branch B' })).toBeVisible();
}

async function shoot(page: Page, name: string) {
  for (const theme of ['dark', 'light'] as const) {
    const toggle = page.getByRole('button', { name: 'Toggle theme' });
    const current = await page.locator('[data-theme]').first().getAttribute('data-theme');
    if (current !== theme) await toggle.click();
    await page.screenshot({
      path: `${SHOTS}/${name}-${theme}-${page.viewportSize()!.width}.png`,
      fullPage: true,
    });
  }
  if ((await page.locator('[data-theme]').first().getAttribute('data-theme')) !== 'dark') {
    await page.getByRole('button', { name: 'Toggle theme' }).click();
  }
}

test.beforeEach(async ({ request }) => {
  await request.get(`${ENGINE}/__reset`);
});

test('the core journey: propose, simulate, authorize, tamper test, commit', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await signIn(page);
  await page.screenshot({ path: `${SHOTS}/workspace-empty-dark-1440.png` });

  await page.getByRole('button', { name: 'Propose branches' }).first().click();
  await expect(page.getByRole('button', { name: /Pay everything/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Share the shortfall/ })).toBeVisible();

  await page.getByRole('button', { name: 'Simulate branches' }).click();
  const a = page.getByRole('button', { name: /Pay everything/ });
  await expect(a).toContainText('Rejected by FORK');
  await expect(a).toContainText('−$18,000');

  // FORK will not let the overdraft branch be authorized
  await a.click();
  await expect(page.getByRole('button', { name: 'Authorize a branch' })).toBeDisabled();
  await expect(page.getByText('Overdraws the account by $18,000.00.')).toBeVisible();

  await page.getByRole('button', { name: /Preserve runway/ }).click();
  await page.getByRole('button', { name: 'Authorize branch B' }).first().click();
  await expect(page.getByRole('dialog')).toContainText('exactly these 6 payments');
  await expect(page.getByRole('dialog')).toContainText('$40,000.00');
  await page.getByRole('button', { name: 'Authorize 6 payments' }).click();

  // the seal shows the same hash the API holds
  await expect(page.getByRole('button', { name: 'Commit branch B' })).toBeVisible();
  const run = await (await page.request.get(`${ENGINE}/api/runs/1`)).json();
  const hash: string = run.branches.find(
    (branch: { label: string }) => branch.label === 'B',
  ).approvedPlanHash;
  await expect(page.getByLabel(`Authorized, plan hash ${hash}`).first()).toBeVisible();
  await shoot(page, 'workspace-authorized');

  await page.getByRole('button', { name: 'Run tamper test' }).click();
  await expect(page.getByText('BLOCKED by ArmorIQ').first()).toBeVisible();
  await expect(page.getByRole('row', { name: /update_vendor_destination/ })).toContainText('BLOCK');
  await expect(
    page.getByRole('row', { name: /recipient-external-999.*refused by the MCP/ }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Commit branch B' }).click();
  await expect(page.getByRole('button', { name: /Preserve runway/ })).toContainText('Committed', {
    timeout: 20_000,
  });
  await expect(page.getByText('$10,000').first()).toBeVisible();
  await expect(page.getByRole('row', { name: /execute_large_payment/ })).toContainText('ALLOW');
  await shoot(page, 'workspace-committed');

  // a reload lands on exactly the same state
  await page.reload();
  await expect(page.getByRole('button', { name: /Preserve runway/ })).toContainText('Committed');
  await expect(page.getByRole('row', { name: /execute_large_payment/ })).toBeVisible();

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

  await page.getByRole('button', { name: 'Commit branch B' }).click();
  await expect(page.getByRole('button', { name: /Preserve runway/ })).toContainText(
    'Partially committed',
    { timeout: 20_000 },
  );
  const attempt = page.getByRole('row', { name: /Agent.*update_vendor_destination/ });
  await expect(attempt).toContainText('BLOCK');
  await expect(attempt).toContainText('IntentMismatchException');
  await shoot(page, 'workspace-blocked');

  await page.getByRole('button', { name: 'Replan from here' }).click();
  const child = page.getByRole('button', { name: /B′/ });
  await expect(child).toContainText('Proposed');
  await expect(child).toContainText('Replan');
  // a new proposal is not an authorization
  await expect(page.getByRole('button', { name: 'Simulate branches' })).toBeVisible();
});

test('without ArmorIQ the app is usable and commit says why it is closed', async ({
  page,
  request,
}) => {
  await request.get(`${ENGINE}/__reset?armoriq=off`);
  await signIn(page);
  await toAuthorized(page).catch(() => undefined);
  const commit = page.getByRole('button', { name: 'Commit branch B' });
  await expect(commit).toBeDisabled();
  await commit.locator('..').hover();
  await expect(page.getByText(/Nothing can be committed/).first()).toBeVisible();
});

test('a phone can do the same job', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await toAuthorized(page);
  await expect(page.getByRole('list', { name: 'Branches' })).toBeVisible();
  await shoot(page, 'workspace-authorized');
  await page.getByRole('button', { name: 'Commit branch B' }).click();
  await expect(page.getByRole('button', { name: /Preserve runway/ })).toContainText('Committed', {
    timeout: 20_000,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

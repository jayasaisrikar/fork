import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const ENGINE = 'http://localhost:8791';
const SHOTS = 'docs/screenshots';

async function serious(page: Page) {
  const axe = await new AxeBuilder({ page }).analyze();
  return axe.violations
    .filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))
    .flatMap((violation) =>
      violation.nodes.map(
        (node) =>
          `${violation.id}: ${node.html.slice(0, 120)} | ${node.failureSummary?.split('\n')[1]?.trim().slice(0, 140)}`,
      ),
    );
}

async function bothThemes(page: Page, name: string) {
  const width = page.viewportSize()!.width;
  await page.screenshot({ path: `${SHOTS}/${name}-light-${width}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await page.screenshot({ path: `${SHOTS}/${name}-dark-${width}.png`, fullPage: true });
  expect(await serious(page)).toEqual([]);
  await page.getByRole('button', { name: 'Toggle theme' }).click();
}

// sign in and commit branch B with a tamper test first, so the records have something to show
async function committedRun(page: Page) {
  await page.goto('/app');
  await page.getByLabel('Email').fill('cfo@kettleandpine.test');
  await page.getByLabel('Password').fill('correct horse');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Propose branches' }).first().click();
  await page.getByRole('button', { name: 'Simulate branches' }).click();
  await page.getByRole('button', { name: /Preserve runway/ }).click();
  await page.getByRole('button', { name: 'Authorize branch B' }).first().click();
  await page.getByRole('button', { name: 'Authorize 6 payments' }).click();
  await page.getByRole('button', { name: 'Run tamper test' }).click();
  await expect(page.getByText('BLOCKED by ArmorIQ').first()).toBeVisible();
  await page.getByRole('button', { name: 'Commit branch B' }).click();
  await expect(page.getByRole('link', { name: 'View run record' })).toBeVisible({
    timeout: 20_000,
  });
}

test.beforeEach(async ({ request }) => {
  await request.get(`${ENGINE}/__reset`);
});

for (const width of [1440, 390]) {
  test(`landing at ${width}px shows the recorded run and has no dead links`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Commit only one.');
    await expect(page.getByText(/Recorded from a real run/)).toBeVisible();
    await expect(page.getByText('BLOCKED by ArmorIQ').first()).toBeVisible();
    await expect(page.getByText('IntentMismatchException').first()).toBeVisible();

    const hrefs = await page
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
    expect(hrefs.filter((href) => href === '' || href === '#')).toEqual([]);
    for (const anchor of hrefs.filter((href) => href.startsWith('#')))
      await expect(page.locator(anchor)).toHaveCount(1);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await bothThemes(page, 'landing');
    expect(errors).toEqual([]);
  });
}

test('landing: selecting a branch updates the numbers beside the graph', async ({ page }) => {
  await page.goto('/');
  const readout = page.locator('dl[aria-live="polite"]');
  const before = await readout.innerText();
  await page.locator('.react-flow button[aria-pressed="false"]').first().click();
  await expect(readout).not.toHaveText(before);
  await page.getByRole('link', { name: 'Open the workspace' }).first().click();
  await expect(page).toHaveURL(/\/app$/);
});

test('run record reconciles and replays without side effects', async ({ page }) => {
  await committedRun(page);
  await page.getByRole('link', { name: 'View run record' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('branch B: Preserve runway');

  await expect(
    page.getByText('All three agree. Every approved payment was made, once.'),
  ).toBeVisible();
  const totals = page.locator('dl', { hasText: 'Authorized by the CFO' });
  await expect(totals).toContainText('$40,000.00');
  await expect(page.getByText('Not in the approved plan')).toBeVisible();
  await expect(page.getByText('Differs in recipientId')).toBeVisible();
  await expect(page.getByText('Allowed by ArmorIQ, then refused by the MCP')).toBeVisible();
  await expect(page.getByText('Approved, then paid')).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export this record as JSON' }).click();
  expect((await download).suggestedFilename()).toBe('fork-run-1.json');

  await page.getByRole('button', { name: 'Replay simulation' }).click();
  await expect(page.getByText('It matches the projection the CFO saw.')).toBeVisible();
  const cash = (await (await page.request.get(`${ENGINE}/api/scenario`)).json()).scenario.cashCents;
  expect(cash).toBe(1_000_000);

  await bothThemes(page, 'run-record');
  await page.getByRole('link', { name: 'Runs', exact: true }).click();
  await expect(page.getByRole('link', { name: /Run #0001/ })).toBeVisible();
});

test('audit: filters, row inspector and exports all show the same evidence', async ({ page }) => {
  await committedRun(page);
  await page.getByRole('link', { name: 'Audit', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Evidence ledger');

  await page.getByRole('button', { name: 'BLOCK', exact: true }).click();
  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('update_vendor_destination');

  await rows.first().click();
  await expect(page.getByRole('dialog')).toContainText('IntentMismatchException');
  await page.getByRole('button', { name: 'Close event' }).click();

  const csvHref = await page.getByRole('link', { name: 'Export CSV' }).getAttribute('href');
  expect(csvHref).toContain('format=csv');
  expect(csvHref).toContain('verdict=block');
  const csv = await (await page.request.get(csvHref!)).text();
  expect(csv.trim().split('\n')).toHaveLength(2);

  await page.getByRole('button', { name: 'REJECTED BY FORK' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('branch.rejected_by_fork');

  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByLabel('Search').fill('CAPABILITY_INVALID');
  await expect(rows).toHaveCount(1);
  await page.getByLabel('Search').fill('');
  await bothThemes(page, 'audit');
});

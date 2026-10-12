import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const ENGINE = 'http://localhost:8791';
const SHOTS = 'test-results/screenshots';

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
  // let the color transitions finish before the picture
  await page.waitForTimeout(350);
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
  await page.getByRole('button', { name: 'Explore options' }).click();
  await page.getByRole('button', { name: /Preserve runway/ }).click();
  await page.getByRole('button', { name: 'Approve plan B' }).click();
  await page.getByRole('button', { name: 'Approve 6 payments' }).click();
  await page.getByRole('button', { name: 'Run tamper test' }).click();
  await expect(page.getByText(/Blocked by ArmorIQ/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Execute plan B' }).click();
  await expect(page.getByRole('link', { name: 'View the receipt' })).toBeVisible({
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
    await expect(page.getByText(/Blocked by ArmorIQ/).first()).toBeVisible();
    await expect(page.getByText('IntentMismatchException').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'See the proof' })).toHaveAttribute(
      'href',
      '/proof',
    );
    await expect(page.getByRole('link', { name: 'Run the proof yourself' })).toHaveAttribute(
      'href',
      '/proof',
    );

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
    // nothing in the hero is cut off at the edge either
    for (const part of [page.getByRole('heading', { level: 1 }), page.locator('dl[aria-live]')]) {
      const box = (await part.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
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
  await page.getByRole('link', { name: 'Open the decision studio' }).first().click();
  await expect(page).toHaveURL(/\/app$/);
});

test('run record reconciles and replays without side effects', async ({ page }) => {
  await committedRun(page);
  await page.getByRole('link', { name: 'View the receipt' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('6 bills paid.');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    '2 unapproved attempts stopped.',
  );
  await expect(page.getByText('Plan B: Preserve runway')).toBeVisible();

  await expect(
    page.getByText('All three agree. Every approved payment was made, once.'),
  ).toBeVisible();
  const totals = page.locator('dl', { hasText: 'Authorized by the CFO' });
  await expect(totals).toContainText('$40,000.00');
  await expect(page.getByText('Not in the approved plan')).toBeVisible();
  await expect(page.getByText('Differs in recipientId')).toBeVisible();
  await expect(page.getByText('Allowed by ArmorIQ, then refused by the MCP').first()).toBeVisible();
  await expect(page.getByText('Approved, then paid')).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export this record as JSON' }).click();
  expect((await download).suggestedFilename()).toBe('fork-run-1.json');

  await page.getByRole('button', { name: 'Replay simulation' }).click();
  await expect(page.getByText('It matches the projection the CFO saw.')).toBeVisible();
  const cash = (await (await page.request.get(`${ENGINE}/api/scenario`)).json()).scenario.cashCents;
  expect(cash).toBe(1_000_000);

  await bothThemes(page, 'run-record');
  await page.getByRole('link', { name: 'History', exact: true }).click();
  await expect(page.getByRole('link', { name: /Run #0001/ })).toBeVisible();
});

test('audit: filters, row inspector and exports all show the same evidence', async ({ page }) => {
  await committedRun(page);
  await page.getByRole('link', { name: 'Activity', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nothing happens quietly.');

  await page.getByRole('button', { name: 'Blocked', exact: true }).click();
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

  await page.getByRole('button', { name: 'Rejected by FORK' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('branch.rejected_by_fork');

  await page.getByRole('button', { name: 'All activity' }).click();
  await page.getByLabel('Search').fill('CAPABILITY_INVALID');
  await expect(rows).toHaveCount(1);
  await page.getByLabel('Search').fill('');
  await bothThemes(page, 'audit');
});

test('how it works explains the harness and links back to the studio', async ({ page }) => {
  await page.goto('/how');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('not another chatbot');
  await expect(page.getByText('interface ForkDomainAdapter')).toBeVisible();
  await bothThemes(page, 'how');
  await page.getByRole('link', { name: 'Open the decision studio' }).click();
  await expect(page).toHaveURL(/\/app$/);
});

for (const width of [1440, 390]) {
  test(`lab at ${width}px forks both domains and the dry run signs nothing`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto('/app/lab');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('One harness. Two domains.');

    // portfolio: read-only, so a feasible branch still has nothing to sign
    await expect(page.getByRole('button', { name: /Trim to the limit/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByText('0 tool steps.')).toBeVisible();
    await page.getByRole('button', { name: /Move it all to T-bills/ }).click();
    await expect(page.getByText('Buys $5,000.00 more than the cash available')).toBeVisible();

    // treasury: the same path, and this one has payments to sign
    await page.getByRole('button', { name: /Treasury/ }).click();
    await expect(page.getByRole('button', { name: /Preserve runway/ })).toContainText('$10,000');
    await expect(page.getByText('9 tool steps')).toBeVisible();
    await page.getByRole('button', { name: /Pay everything/ }).click();
    await expect(page.getByText('Overdraws the account by $18,000')).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await bothThemes(page, 'lab');
    expect(errors).toEqual([]);
  });
}

test('proof: the recorded attack, then a live probe, with nobody signed in', async ({
  page,
  request,
}) => {
  await request.get(`${ENGINE}/__reset`);
  const errors: string[] = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.goto('/proof');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('One approval');
  const recorded = page.getByRole('region', { name: 'Recorded agent execution' });
  await expect(recorded.getByText('$4,000 paid as approved')).toBeVisible();
  await expect(recorded.getByText("$0 to the attacker's recipient")).toBeVisible();
  await expect(recorded.getByText('IntentMismatchException')).toBeVisible();
  await expect(recorded.getByText(/no approved-execution capability/)).toBeVisible();
  await expect(page.getByText(/ledger (was )?unchanged/i)).toHaveCount(0);

  const probe = page.getByRole('region', { name: 'Live security probe' });
  await expect(probe.getByText('A scripted probe, not an agent')).toBeVisible();
  await probe.getByRole('radio', { name: 'Forbidden tool' }).check();
  await probe.getByRole('button', { name: 'Run it now' }).click();
  await expect(probe.getByText('Run just now')).toBeVisible();
  await expect(probe.getByText('PolicyBlockedException')).toBeVisible();
  await expect(probe.getByText('ArmorIQ policy')).toBeVisible();
  await expect(probe.getByText('Never reached the server')).toBeVisible();
  await expect(probe.getByText('Unexpected')).toHaveCount(0);

  await bothThemes(page, 'proof');
  expect(errors).toEqual([]);
});

test('proof: the recording stands when the engine cannot be reached', async ({ page }) => {
  await page.route('**/api/proof/run', (route) => route.abort());
  await page.goto('/proof');
  const probe = page.getByRole('region', { name: 'Live security probe' });
  await probe.getByRole('button', { name: 'Run it now' }).click();
  await expect(probe.getByRole('alert')).toContainText("didn't respond");
  await expect(
    page
      .getByRole('region', { name: 'Recorded agent execution' })
      .getByText('$4,000 paid as approved'),
  ).toBeVisible();
});

test('proof: a phone shows it without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/proof');
  await expect(page.getByText('$4,000 paid as approved')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

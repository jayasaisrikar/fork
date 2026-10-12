import { describe, expect, it } from 'vitest';
import { financeAdapter } from './adapter';
import { liquidityShortfall, PROOF_SCENARIO, proofSandbox, referenceBranches } from './fixtures';

describe('proof sandbox fixture', () => {
  it('shares no vendor or invoice id with the treasury scenario', () => {
    const treasury = liquidityShortfall();
    const sandbox = proofSandbox();
    const taken = new Set([...treasury.vendors, ...treasury.invoices].map((row) => row.id));
    expect([...sandbox.vendors, ...sandbox.invoices].filter((row) => taken.has(row.id))).toEqual(
      [],
    );
    expect(sandbox.scenarioId).toBe(PROOF_SCENARIO);
  });

  it('keeps branch B feasible, with Harbor Hosting $4,000 as its first payment', () => {
    const state = proofSandbox();
    const b = referenceBranches(state)[1]!;
    const projection = financeAdapter.simulate(state, b.allocations);
    expect(financeAdapter.feasibility(state, projection)).toMatchObject({ ok: true });

    const first = financeAdapter
      .toToolSteps(state, b.allocations, 'test')
      .find((step) => step.kind === 'write')!;
    expect(first.tool).toBe('execute_payment');
    expect(first.args).toMatchObject({
      scenarioId: PROOF_SCENARIO,
      vendorId: 'proof-v-harbor',
      amountCents: 400_000,
    });
  });

  it('defers the same two vendors in branch B whatever the id scheme', () => {
    for (const state of [liquidityShortfall(), proofSandbox()]) {
      const deferred = referenceBranches(state)[1]!
        .allocations.filter((allocation) => allocation.payCents === 0)
        .map((allocation) => {
          const invoice = state.invoices.find((item) => item.id === allocation.invoiceId)!;
          return state.vendors.find((vendor) => vendor.id === invoice.vendorId)!.name;
        });
      expect(deferred).toEqual(['Meridian Cloud', 'Alto Manufacturing']);
    }
  });
});

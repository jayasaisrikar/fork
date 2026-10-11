import type { Feasibility, ForkDomainAdapter } from './adapter';
import { assertBranchTransition, type BranchStatus } from './lifecycle';

export type { ForkDomainAdapter } from './adapter';

export interface Proposal {
  label: string;
  title: string;
  rationale: string;
  // untrusted until the adapter has validated it
  actions: unknown;
}

export interface DryBranch<Action, Projection, Diff> {
  label: string;
  title: string;
  rationale: string;
  status: Extract<BranchStatus, 'SIMULATED' | 'INFEASIBLE'>;
  actions: Action[];
  projection: Projection;
  diff: Diff;
  feasibility: Feasibility;
}

// fork without a database or a signer: validate, simulate, check. nothing here can execute.
export function dryRun<Base, Action, Projection, Diff, Receipt>(
  adapter: ForkDomainAdapter<Base, Action, Projection, Diff, Receipt>,
  base: Base,
  proposals: Proposal[],
): DryBranch<Action, Projection, Diff>[] {
  return proposals.map(({ label, title, rationale, actions: input }) => {
    const actions = adapter.validateActions(base, input);
    const projection = adapter.simulate(base, actions);
    const feasibility = adapter.feasibility(base, projection);
    const status = feasibility.ok ? 'SIMULATED' : 'INFEASIBLE';
    assertBranchTransition('PROPOSED', status);
    return {
      label,
      title,
      rationale,
      status,
      actions,
      projection,
      diff: adapter.diff(base, projection),
      feasibility,
    };
  });
}

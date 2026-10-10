import type { BranchStatus } from './lifecycle';

export type StepResult =
  | { status: 'EXECUTED' }
  // refused or failed: the branch stops here
  | { status: 'DENIED' | 'FAILED' }
  // a hold nobody approved: skip this step, carry on with the rest
  | { status: 'NOT_EXECUTED' };

export interface RunnerPorts<Step> {
  steps: Step[];
  isWrite(step: Step): boolean;
  // steps that already finished in an earlier attempt
  alreadyDone(step: Step): StepResult | undefined;
  cancelled(): boolean;
  execute(step: Step): Promise<StepResult>;
  skip(step: Step, reason: 'cancelled' | 'stopped'): void;
}

export interface RunSummary {
  final: Extract<BranchStatus, 'COMMITTED' | 'PARTIALLY_COMMITTED' | 'BLOCKED' | 'CANCELLED'>;
  executedWrites: number;
  totalWrites: number;
}

// plain code, no model. runs the approved steps in order and stops at the first refusal.
export async function runSteps<Step>(ports: RunnerPorts<Step>): Promise<RunSummary> {
  let stop: 'cancelled' | 'stopped' | undefined;
  let executedWrites = 0;

  for (const step of ports.steps) {
    const done = ports.alreadyDone(step);
    if (done) {
      if (done.status === 'EXECUTED' && ports.isWrite(step)) executedWrites += 1;
      if (done.status === 'DENIED' || done.status === 'FAILED') stop ??= 'stopped';
      continue;
    }
    if (!stop && ports.cancelled()) stop = 'cancelled';
    if (stop) {
      ports.skip(step, stop);
      continue;
    }

    const result = await ports.execute(step);
    if (result.status === 'EXECUTED' && ports.isWrite(step)) executedWrites += 1;
    if (result.status === 'DENIED' || result.status === 'FAILED') stop = 'stopped';
  }

  const totalWrites = ports.steps.filter((step) => ports.isWrite(step)).length;
  let final: RunSummary['final'];
  if (executedWrites === totalWrites && !stop) final = 'COMMITTED';
  else if (stop === 'cancelled') final = 'CANCELLED';
  else if (executedWrites > 0) final = 'PARTIALLY_COMMITTED';
  else final = 'BLOCKED';
  return { final, executedWrites, totalWrites };
}

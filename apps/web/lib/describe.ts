import { usdShort } from './format';
import type { Branch, Step } from './types';

export type StepTone = 'good' | 'bad' | 'gold' | 'gray' | 'purple';

export interface Told {
  title: string;
  note?: string;
  tone: StepTone;
}

// a refused attempt: it got a verdict and nothing was executed
export const isRefused = (step: Step) =>
  Boolean(step.verdict) && step.status === 'NOT_EXECUTED' && step.verdict !== 'hold';

// one tool call, in the words a CFO would use. the tool name and verdict are shown next to it.
export function describeStep(step: Step, vendorName: (id: unknown) => string): Told {
  const amount = step.args.amountCents ? usdShort(Number(step.args.amountCents)) : '';
  const vendor = vendorName(step.args.vendorId);
  const pays = step.tool.startsWith('execute_');

  if (step.status === 'EXECUTED') {
    if (pays) return { title: `Paid ${vendor} ${amount}`, tone: 'good' };
    if (step.tool === 'get_treasury_balance')
      return { title: 'Checked the bank balance', tone: 'gray' };
    if (step.tool === 'get_sandbox_messages') return { title: 'Read the inbox', tone: 'gray' };
    return { title: `Ran ${step.tool}`, tone: 'gray' };
  }
  if (step.status === 'HELD') {
    return {
      title: `Waiting for a person to approve ${amount} to ${vendor}`,
      note: 'Large payments are held by ArmorIQ until someone approves them there.',
      tone: 'gold',
    };
  }
  if (isRefused(step)) {
    const to = String(step.args.recipientId ?? 'an unknown recipient');
    const what =
      step.tool === 'update_vendor_destination'
        ? `change ${vendor}'s bank details to ${to}`
        : pays
          ? `pay ${amount} to ${to}`
          : `call ${step.tool}`;
    if (step.source === 'armoriq')
      return {
        title: `Blocked by ArmorIQ: an attempt to ${what}`,
        note: 'This call was not in the plan the CFO approved.',
        tone: 'bad',
      };
    if (step.source === 'mcp')
      return {
        title: `Allowed by ArmorIQ, then refused by the MCP: an attempt to ${what}`,
        note: 'The payment server only accepts the single-use capability minted for an approved payment.',
        tone: 'purple',
      };
    return { title: `Rejected by FORK: an attempt to ${what}`, tone: 'purple' };
  }
  if (step.status === 'NOT_EXECUTED') {
    if (step.verdict === 'hold')
      return { title: `Not approved in ArmorIQ: ${vendor} ${amount} was not paid`, tone: 'gold' };
    return {
      title: pays ? `Not paid: ${vendor} ${amount}` : `Not run: ${step.tool}`,
      note: 'The plan stopped before this step.',
      tone: 'gray',
    };
  }
  return { title: `${step.tool}: ${step.status.toLowerCase().replace(/_/g, ' ')}`, tone: 'gray' };
}

export const DONE: Branch['status'][] = [
  'COMMITTED',
  'PARTIALLY_COMMITTED',
  'BLOCKED',
  'CANCELLED',
];

const STATUS: Record<Branch['status'], { text: string; tone: StepTone | 'accent' }> = {
  PROPOSED: { text: 'Proposed', tone: 'gray' },
  SIMULATED: { text: 'Simulated', tone: 'gray' },
  APPROVED: { text: 'Approved', tone: 'accent' },
  COMMITTING: { text: 'Executing', tone: 'accent' },
  COMMITTED: { text: 'Completed', tone: 'good' },
  PARTIALLY_COMMITTED: { text: 'Stopped early', tone: 'gold' },
  BLOCKED: { text: 'Blocked', tone: 'bad' },
  CANCELLED: { text: 'Cancelled', tone: 'gray' },
  INFEASIBLE: { text: 'Rejected by FORK', tone: 'purple' },
  STALE: { text: 'Out of date', tone: 'gray' },
};

export const statusOf = (status: Branch['status']) => STATUS[status];

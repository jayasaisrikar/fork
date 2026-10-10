import {
  DelegationException,
  IntentMismatchException,
  InvalidTokenException,
  PolicyBlockedException,
  PolicyHoldException,
  RevokedTokenError,
  TokenExpiredException,
  type MCPInvocationResult,
} from '@armoriq/sdk';

export type Verdict = 'allow' | 'hold' | 'block' | 'error';

export interface Decision {
  verdict: Verdict;
  errorClass?: string;
  message?: string;
  delegationId?: string;
  // ArmorIQ let the call through and the tool itself refused it
  toolError?: { code: string; message: string };
}

export type Outcome = { resolved: MCPInvocationResult } | { thrown: unknown };

const BLOCKS = [
  IntentMismatchException,
  PolicyBlockedException,
  TokenExpiredException,
  InvalidTokenException,
  RevokedTokenError,
];
const BLOCK_NAMES = new Set(BLOCKS.map((type) => type.name));

function toolErrorOf(result: MCPInvocationResult): Decision['toolError'] {
  if (result.status !== 'error' && !result.metadata?.hasToolError) return undefined;
  const text: unknown = result.result?.content?.[0]?.text;
  try {
    const parsed = JSON.parse(String(text));
    if (parsed?.error?.code)
      return { code: String(parsed.error.code), message: String(parsed.error.message ?? '') };
  } catch {
    // not ours, fall through
  }
  return {
    code: 'TOOL_ERROR',
    message: typeof text === 'string' ? text.slice(0, 300) : 'The tool reported an error',
  };
}

// the only place a verdict is ever made
export function toVerdict(outcome: Outcome): Decision {
  if ('resolved' in outcome) {
    return { verdict: 'allow', toolError: toolErrorOf(outcome.resolved) };
  }

  const error = outcome.thrown;
  const name = error instanceof Error ? error.constructor.name : 'UnknownError';
  const named = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof PolicyHoldException || named === 'PolicyHoldException') {
    const delegationId = (error as PolicyHoldException).delegationContext?.delegationId;
    return { verdict: 'hold', errorClass: 'PolicyHoldException', message, delegationId };
  }
  // a hold that was rejected, expired or never answered. still not an approval.
  if (error instanceof DelegationException) {
    return {
      verdict: 'hold',
      errorClass: 'DelegationException',
      message,
      delegationId: error.delegationId,
    };
  }
  if (BLOCKS.some((type) => error instanceof type) || BLOCK_NAMES.has(named)) {
    return { verdict: 'block', errorClass: BLOCK_NAMES.has(named) ? named : name, message };
  }
  return { verdict: 'error', errorClass: name, message };
}

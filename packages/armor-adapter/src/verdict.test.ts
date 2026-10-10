import {
  ConfigurationException,
  DelegationException,
  IntentMismatchException,
  InvalidTokenException,
  MCPInvocationException,
  PolicyBlockedException,
  PolicyHoldException,
  RevokedTokenError,
  TokenExpiredException,
  type MCPInvocationResult,
} from '@armoriq/sdk';
import { describe, expect, it } from 'vitest';
import { toVerdict } from './verdict';

const resolved = (text: string, hasToolError = false): MCPInvocationResult => ({
  mcp: 'fork-finance-mcp',
  action: 'execute_payment',
  result: { content: [{ type: 'text', text }] },
  status: hasToolError ? 'error' : 'success',
  verified: true,
  metadata: { hasToolError },
});

describe('toVerdict', () => {
  it('allows a call that resolved', () => {
    expect(toVerdict({ resolved: resolved('{"receipt":{"id":"r1"}}') })).toEqual({
      verdict: 'allow',
      toolError: undefined,
    });
  });

  it('keeps allow but carries the tool error when the MCP refused', () => {
    const text = '{"error":{"code":"CAPABILITY_INVALID","message":"nope"}}';
    expect(toVerdict({ resolved: resolved(text, true) })).toEqual({
      verdict: 'allow',
      toolError: { code: 'CAPABILITY_INVALID', message: 'nope' },
    });
  });

  it('holds on PolicyHoldException and keeps the delegation id', () => {
    const decision = toVerdict({
      thrown: new PolicyHoldException('held', { delegationId: 'd-1' }),
    });
    expect(decision).toMatchObject({
      verdict: 'hold',
      errorClass: 'PolicyHoldException',
      delegationId: 'd-1',
    });
  });

  it('treats an unresolved hold as a hold, never as allow', () => {
    const decision = toVerdict({
      thrown: new DelegationException('Delegation rejected', undefined, 'd-2'),
    });
    expect(decision).toMatchObject({
      verdict: 'hold',
      errorClass: 'DelegationException',
      delegationId: 'd-2',
    });
  });

  it.each([
    new IntentMismatchException('not in plan'),
    new PolicyBlockedException('blocked'),
    new TokenExpiredException('expired'),
    new InvalidTokenException('bad token'),
    new RevokedTokenError('revoked'),
  ])('blocks on %o', (thrown) => {
    expect(toVerdict({ thrown })).toMatchObject({
      verdict: 'block',
      errorClass: thrown.constructor.name,
    });
  });

  it('blocks on the plain Error the SDK tags by name', () => {
    const thrown = Object.assign(new Error('denied by OPA'), { name: 'PolicyBlockedException' });
    expect(toVerdict({ thrown })).toMatchObject({
      verdict: 'block',
      errorClass: 'PolicyBlockedException',
    });
  });

  it.each([
    new MCPInvocationException('boom'),
    new ConfigurationException('bad config'),
    new Error('socket hang up'),
    'a string',
    undefined,
    { verdict: 'allow' },
  ])('maps %o to error, never allow', (thrown) => {
    expect(toVerdict({ thrown }).verdict).toBe('error');
  });
});

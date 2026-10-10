// test double for the ArmorIQ gateway. it enforces plan membership and a small policy the way the
// real proxy does, then calls the MCP app in-process. verdicts still come from the real toVerdict.
import {
  DelegationException,
  IntentMismatchException,
  PolicyBlockedException,
  PolicyHoldException,
  type MCPInvocationResult,
} from '@armoriq/sdk';
import type { DispatchResult, Gateway, PlanStep } from '../src/gateway';
import { toVerdict } from '../src/verdict';

interface McpApp {
  request(path: string, init: RequestInit): Response | Promise<Response>;
}

export interface FakeOptions {
  mcp: McpApp;
  mcpKey: string;
  block?: string[];
  hold?: string[];
  approveHolds?: boolean;
  signFails?: boolean;
  // act like the process died right after this many tool calls reached the MCP
  crashAfterCalls?: number;
}

export function fakeGateway(options: FakeOptions) {
  const plans = new Map<string, string[]>();
  const closed: { planId: string; status: string }[] = [];
  const dispatched: PlanStep[] = [];
  let signs = 0;
  let mcpCalls = 0;

  async function callMcp(step: PlanStep): Promise<MCPInvocationResult> {
    const response = await options.mcp.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-fork-mcp-key': options.mcpKey,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: step.action, arguments: step.params },
      }),
    });
    const body = (await response.json()) as { result?: { isError?: boolean } };
    const hasToolError = Boolean(body.result?.isError);
    return {
      mcp: 'fork-finance-mcp',
      action: step.action,
      result: body.result,
      status: hasToolError ? 'error' : 'success',
      verified: true,
      metadata: { hasToolError },
    };
  }

  const gateway: Gateway = {
    async sign(_goal, steps) {
      if (options.signFails) throw new Error('connect ECONNREFUSED');
      signs += 1;
      const planId = `plan-${signs}`;
      plans.set(
        planId,
        steps.map((step) => step.action),
      );
      return {
        planId,
        planHash: `hash-${signs}`,
        merkleRoot: `root-${signs}`,
        tokenId: `token-${signs}`,
        expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
      };
    },

    async dispatch(planId, step, dispatchOptions = {}): Promise<DispatchResult> {
      dispatched.push(step);
      const decide = (thrown: unknown) => ({ ...toVerdict({ thrown }), latencyMs: 1 });
      const actions = plans.get(planId);
      if (!actions) return decide(new Error(`No intent token held for plan ${planId}`));
      if (!actions.includes(step.action)) {
        return decide(
          new IntentMismatchException(`Action '${step.action}' not found in the original plan`),
        );
      }
      if (options.block?.includes(step.action)) {
        return decide(new PolicyBlockedException(`Tool '${step.action}' denied by policy`));
      }
      if (options.hold?.includes(step.action)) {
        const held = new PolicyHoldException('Action held for approval');
        const { verdict } = toVerdict({ thrown: held });
        dispatchOptions.onHold?.({ verdict, reason: 'held by policy' });
        if (!dispatchOptions.waitForApproval) return decide(held);
        dispatchOptions.onHold?.({ verdict, delegationId: 'dlg-1', reason: 'held by policy' });
        if (!options.approveHolds)
          return decide(new DelegationException('Delegation rejected', undefined, 'dlg-1'));
      }

      const resolved = await callMcp(step);
      mcpCalls += 1;
      if (options.crashAfterCalls === mcpCalls) throw new Error('simulated crash');
      return { ...toVerdict({ resolved }), result: resolved.result, latencyMs: 1 };
    },

    async close(planId, status) {
      plans.delete(planId);
      closed.push({ planId, status });
    },

    async health() {
      return { reachable: true, tools: [] };
    },
  };

  return Object.assign(gateway, { closed, dispatched, signCount: () => signs });
}

import {
  DelegationException,
  PolicyHoldException,
  type ArmorIQClient,
  type IntentToken,
  type MCPInvocationResult,
} from '@armoriq/sdk';
import { createArmorClient, type ArmorConfig } from './client';
import { toVerdict, type Decision } from './verdict';

export interface PlanStep {
  action: string;
  params: Record<string, unknown>;
}

export interface SignedPlan {
  planId: string;
  planHash: string;
  merkleRoot: string;
  tokenId: string;
  expiresAt: string;
}

const HOLD_POLL_MS = 3000;

export interface DispatchOptions {
  // wait on the platform for a human instead of failing straight away
  waitForApproval?: boolean;
  holdTimeoutMs?: number;
  onHold?: (hold: { delegationId?: string; reason: string }) => void;
}

export interface DispatchResult extends Decision {
  result?: unknown;
  latencyMs: number;
}

export interface GatewayHealth {
  reachable: boolean;
  tools: string[];
  detail?: string;
}

export interface Gateway {
  sign(goal: string, steps: PlanStep[], validitySeconds?: number): Promise<SignedPlan>;
  dispatch(planId: string, step: PlanStep, options?: DispatchOptions): Promise<DispatchResult>;
  close(planId: string, status: 'completed' | 'failed'): Promise<void>;
  health(): Promise<GatewayHealth>;
}

export interface GatewayConfig extends ArmorConfig {
  userEmail: string;
  // who asks for approval on a held call. ArmorIQ will not let the requester approve their own
  // request, so this is the agent's identity, never the CFO's.
  requesterEmail: string;
}

export function createGateway(config: GatewayConfig): Gateway {
  let client: ArmorIQClient | undefined;
  const armor = () => (client ??= createArmorClient(config));
  // tokens stay in this process. nothing else, least of all a model, gets to see one.
  const tokens = new Map<string, IntentToken>();

  // ArmorIQ held the call. open the approval request ourselves, with the real amount, and wait for
  // a human on the platform. the SDK's own wait reads the amount from tool metadata we cannot set.
  async function afterApproval(
    token: IntentToken,
    step: PlanStep,
    hold: PolicyHoldException,
    options: DispatchOptions,
    invoke: (params: Record<string, unknown>) => Promise<MCPInvocationResult>,
  ) {
    const reason = hold.message || 'Held for approval';
    options.onHold?.({ reason });
    const context = hold.delegationContext ?? {};
    const request = await armor().createDelegationRequest({
      tool: step.action,
      action: 'execute',
      // the approver sees these, so the capability stays out
      arguments: { ...step.params, approvedExecutionRef: undefined },
      amount: Number(step.params.amount ?? 0),
      requesterEmail: config.requesterEmail,
      requesterRole: 'agent_user',
      requesterLimit: 0,
      domain: context.domain ?? config.mcpName,
      targetUrl: context.targetUrl,
      planId: context.planId ?? token.planId,
      intentReference: context.intentReference ?? token.tokenId,
      merkleRoot: context.merkleRoot ?? token.planHash,
      reason,
    });
    const delegationId = request.delegationId;
    options.onHold?.({ delegationId, reason });

    const deadline = Date.now() + (options.holdTimeoutMs ?? 180_000);
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, HOLD_POLL_MS));
      const status = await armor().getDelegationStatus(delegationId);
      if (status === 'approved') {
        const result = await invoke({
          ...step.params,
          _delegation_id: delegationId,
          _approvals: 999,
        });
        await armor().markDelegationExecuted(config.requesterEmail, delegationId, token.planId);
        return result;
      }
      if (status === 'rejected' || status === 'expired') {
        throw new DelegationException(`Delegation ${status}`, undefined, delegationId);
      }
    }
    throw new DelegationException('Nobody approved the payment in time', undefined, delegationId);
  }

  return {
    async sign(goal, steps, validitySeconds = 1800) {
      const plan = { goal, steps: steps.map((step) => ({ ...step, mcp: config.mcpName })) };
      const capture = armor().capturePlan('fork', goal, plan);
      const token = await armor().getIntentToken(capture, undefined, validitySeconds);
      const planId = token.planId ?? token.tokenId;
      tokens.set(planId, token);
      return {
        planId,
        planHash: token.planHash,
        merkleRoot: String(token.rawToken?.merkle_root ?? token.planHash),
        tokenId: token.tokenId,
        expiresAt: new Date(token.expiresAt * 1000).toISOString(),
      };
    },

    async dispatch(planId, step, options = {}) {
      const started = Date.now();
      const token = tokens.get(planId);
      const invoke = (params: Record<string, unknown>) =>
        armor().invokeWithPolicy(config.mcpName, step.action, token!, params, {
          userEmail: config.userEmail,
        });
      try {
        if (!token) throw new Error(`No intent token held for plan ${planId}`);
        let resolved;
        try {
          resolved = await invoke(step.params);
        } catch (thrown) {
          const held =
            thrown instanceof PolicyHoldException ||
            (thrown as Error)?.name === 'PolicyHoldException';
          if (!held || !options.waitForApproval) throw thrown;
          resolved = await afterApproval(
            token,
            step,
            thrown as PolicyHoldException,
            options,
            invoke,
          );
        }
        return {
          ...toVerdict({ resolved }),
          result: resolved.result,
          latencyMs: Date.now() - started,
        };
      } catch (thrown) {
        return { ...toVerdict({ thrown }), latencyMs: Date.now() - started };
      }
    },

    async close(planId, status) {
      tokens.delete(planId);
      await armor().updatePlanStatus(planId, status);
    },

    async health() {
      try {
        const boot = await armor().bootstrap();
        const mcps: { name?: string; tools?: string[] }[] = Array.isArray(boot.mcps)
          ? boot.mcps
          : [];
        const ours = mcps.find((mcp) => mcp.name === config.mcpName);
        if (!ours)
          return {
            reachable: true,
            tools: [],
            detail: `${config.mcpName} is not registered on ArmorIQ`,
          };
        return { reachable: true, tools: ours.tools ?? [] };
      } catch (error) {
        return {
          reachable: false,
          tools: [],
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

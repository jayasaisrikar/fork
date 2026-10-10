import type { ArmorIQClient, IntentToken } from '@armoriq/sdk';
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
}

export function createGateway(config: GatewayConfig): Gateway {
  let client: ArmorIQClient | undefined;
  const armor = () => (client ??= createArmorClient(config));
  // tokens stay in this process. nothing else, least of all a model, gets to see one.
  const tokens = new Map<string, IntentToken>();

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
      try {
        if (!token) throw new Error(`No intent token held for plan ${planId}`);
        const resolved = await armor().invokeWithPolicy(
          config.mcpName,
          step.action,
          token,
          step.params,
          {
            userEmail: config.userEmail,
            waitForApproval: options.waitForApproval,
            delegationTimeoutMs: options.holdTimeoutMs,
            onHold: (info) =>
              options.onHold?.({ delegationId: info.delegationId, reason: info.reason }),
          },
        );
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

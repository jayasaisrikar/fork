import { ArmorIQClient } from '@armoriq/sdk';

export type { HoldInfo, IntentToken, MCPInvocationResult } from '@armoriq/sdk';
export type ArmorClient = ArmorIQClient;

export const MCP_KEY_HEADER = 'X-Fork-MCP-Key';

export interface ArmorConfig {
  apiKey: string;
  agentId?: string;
  userId?: string;
  mcpName: string;
  mcpKey: string;
}

export function createArmorClient(config: ArmorConfig): ArmorClient {
  return new ArmorIQClient({
    apiKey: config.apiKey,
    agentId: config.agentId,
    userId: config.userId,
    // the proxy forwards this to our MCP
    mcpCredentials: {
      [config.mcpName]: { authType: 'api_key', apiKey: config.mcpKey, headerName: MCP_KEY_HEADER },
    },
  });
}

/** Money is integer cents everywhere inside FORK. Dollars exist only at the payments-mcp boundary. */
export type Cents = number;

export const MCP = {
  treasury: 'treasury-mcp',
  payments: 'payments-mcp',
} as const;
export type McpName = (typeof MCP)[keyof typeof MCP];

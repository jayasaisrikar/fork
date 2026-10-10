export * from './canonical';
export * from './money';

// must match the name registered on platform.armoriq.ai
export const FINANCE_MCP = 'fork-finance-mcp';

// payments above the scenario's hold threshold must use the large tool, which ArmorIQ holds for a human
export const PAYMENT_TOOL = 'execute_payment';
export const LARGE_PAYMENT_TOOL = 'execute_large_payment';
export type PaymentTool = typeof PAYMENT_TOOL | typeof LARGE_PAYMENT_TOOL;

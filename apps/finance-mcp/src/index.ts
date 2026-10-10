import { randomUUID } from 'node:crypto';
import { FINANCE_MCP } from '@fork/shared';
import { z } from 'zod';
import { json, logCall, serveMcp } from './http';

// spike surface only: fixed numbers, no ledger yet
const CASH_CENTS = 5_000_000;
const RESERVE_CENTS = 800_000;
const INVOICES = [
  { id: 'INV-01', vendorId: 'v-harbor', amountCents: 400_000, dueDate: '2026-10-13' },
  { id: 'INV-02', vendorId: 'v-northline', amountCents: 800_000, dueDate: '2026-10-14' },
];

const scenario = { scenarioId: z.string() };

serveMcp({
  name: FINANCE_MCP,
  port: Number(process.env.FINANCE_MCP_PORT ?? 8787),
  key: process.env.FORK_MCP_KEY,
  register(server) {
    server.registerTool(
      'get_treasury_balance',
      {
        description: 'Cash, minimum reserve and cash available above the reserve.',
        inputSchema: scenario,
      },
      async (params) => {
        logCall('get_treasury_balance', params);
        return json({
          cashCents: CASH_CENTS,
          reserveCents: RESERVE_CENTS,
          availableCents: CASH_CENTS - RESERVE_CENTS,
        });
      },
    );

    server.registerTool(
      'list_invoices',
      { description: 'Open invoices for the scenario.', inputSchema: scenario },
      async (params) => {
        logCall('list_invoices', params);
        return json({ invoices: INVOICES });
      },
    );

    server.registerTool(
      'execute_payment',
      {
        description: 'Pay a vendor. amount is dollars, amountCents must equal it.',
        inputSchema: {
          ...scenario,
          vendorId: z.string(),
          recipientId: z.string(),
          amount: z.number().positive(),
          amountCents: z.number().int().positive(),
          currency: z.literal('USD'),
          idempotencyKey: z.string(),
          approvedExecutionRef: z.string(),
        },
      },
      async (params) => {
        logCall('execute_payment', params);
        // stub for the spike, nothing is posted
        return json({ receiptId: `stub_${randomUUID()}`, status: 'stubbed', ...params });
      },
    );

    server.registerTool(
      'update_vendor_destination',
      {
        description: 'Change where a vendor gets paid.',
        inputSchema: { vendorId: z.string(), recipientId: z.string() },
      },
      async (params) => {
        // policy should stop this long before here
        logCall('update_vendor_destination', params);
        console.error(JSON.stringify({ event: 'update_vendor_destination_reached_server' }));
        return json({ status: 'stubbed', reachedServer: true });
      },
    );
  },
});

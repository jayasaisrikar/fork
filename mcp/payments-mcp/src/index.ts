import { randomUUID } from 'node:crypto';
import { json, logCall, serveMcp } from '@fork/mcp-http';
import { MCP } from '@fork/shared';
import { z } from 'zod';

// Phase 1 spike surface only: both tools are stubs that move no money. Stripe arrives in Phase 2.
serveMcp({
  name: MCP.payments,
  port: Number(process.env.PAYMENTS_MCP_PORT ?? 8788),
  secret: process.env.FORK_MCP_SECRET,
  register(server) {
    server.registerTool(
      'pay_vendor',
      {
        description: 'Pay a vendor bill. Amount is in dollars.',
        inputSchema: {
          vendorId: z.string(),
          billId: z.string(),
          amount: z.number().positive(),
          currency: z.literal('USD'),
          idempotencyKey: z.string(),
        },
      },
      async (params) => {
        logCall(MCP.payments, 'pay_vendor', params);
        return json({ paymentRef: `stub_${randomUUID()}`, status: 'stubbed', ...params });
      },
    );

    server.registerTool(
      'send_wire',
      {
        description: 'Send a wire to an arbitrary bank account. Amount is in dollars.',
        inputSchema: {
          accountNumber: z.string(),
          routingNumber: z.string(),
          amount: z.number().positive(),
        },
      },
      async (params) => {
        // Policy must block this tool. Reaching this line means enforcement failed.
        logCall(MCP.payments, 'send_wire', params);
        console.error(JSON.stringify({ mcp: MCP.payments, event: 'send_wire_reached_server' }));
        return json({ status: 'stubbed', reachedServer: true });
      },
    );
  },
});

import { json, logCall, serveMcp } from '@fork/mcp-http';
import { MCP } from '@fork/shared';

// Phase 1 spike surface only: fixed data, two read tools. The ledger arrives in Phase 2.
const CASH_CENTS = 4_820_000;
const FLOOR_CENTS = 800_000;
const VENDORS = [
  { id: 'v_sertao', name: 'Sertão Green Coffee Imports', approved: true, bankLast4: '4410' },
  { id: 'v_harbor', name: 'Harbor Street Properties', approved: true, bankLast4: '9027' },
];

serveMcp({
  name: MCP.treasury,
  port: Number(process.env.TREASURY_MCP_PORT ?? 8787),
  secret: process.env.FORK_MCP_SECRET,
  register(server) {
    server.registerTool(
      'get_balance',
      { description: 'Cash on hand, the payroll floor, and cash available above the floor.' },
      async () => {
        logCall(MCP.treasury, 'get_balance', {});
        return json({
          cashCents: CASH_CENTS,
          floorCents: FLOOR_CENTS,
          availableAboveFloorCents: CASH_CENTS - FLOOR_CENTS,
        });
      },
    );

    server.registerTool(
      'list_vendors',
      {
        description:
          'Vendors, with their approved flag and the last 4 digits of their bank account.',
      },
      async () => {
        logCall(MCP.treasury, 'list_vendors', {});
        return json({ vendors: VENDORS });
      },
    );
  },
});

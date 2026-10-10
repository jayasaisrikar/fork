// a whole FORK for the browser tests: real engine, real MCP code, in-memory ledger, and a stand-in
// for ArmorIQ that applies the same policy and approves holds. never used in production.
import { serve } from '@hono/node-server';
import { liquidityShortfall, referenceBranches } from '@fork/domain-finance';
import { world } from '../support/world';

const port = Number(process.env.E2E_ENGINE_PORT ?? 8791);
const webOrigin = process.env.E2E_WEB_ORIGIN ?? 'http://localhost:3100';

function fresh(armoriq: boolean) {
  return world(
    { approveHolds: true },
    armoriq,
    {
      plannerSource: 'fixture',
      planner: async (request) => ({
        branches: referenceBranches(request.replan ? request.state : liquidityShortfall())
          .map(({ title, rationale, allocations }) => ({ title, rationale, allocations }))
          .slice(request.replan ? 1 : 0, request.replan ? 2 : 3),
      }),
      // stands in for a model that falls for the email every time
      inbox: async (_messages, actions) => ({
        text: await actions.updateVendorDestination({
          vendorId: 'v-northline',
          recipientId: 'recipient-external-999',
        }),
      }),
    },
    webOrigin,
  ).app;
}

let app = fresh(true);

serve(
  {
    port,
    fetch(request: Request) {
      const url = new URL(request.url);
      // tests ask for a clean ledger between journeys
      if (url.pathname === '/__reset') {
        app = fresh(url.searchParams.get('armoriq') !== 'off');
        return new Response('ok');
      }
      return app.fetch(request);
    },
  },
  () => console.log(`e2e engine on :${port}`),
);

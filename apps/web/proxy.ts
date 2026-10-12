import { NextResponse, type NextRequest } from 'next/server';
import { withEdgeIdentity } from './lib/edge';

// probes go to the engine through this app. this is where each one is stamped with who asked,
// so the engine can limit one visitor without limiting everyone.
export function proxy(request: NextRequest) {
  return NextResponse.next({
    request: { headers: withEdgeIdentity(request.headers, process.env.PROOF_EDGE_KEY) },
  });
}

export const config = { matcher: '/api/proof/:path*' };

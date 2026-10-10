import type { NextConfig } from 'next';

// when hosted, the browser talks to the engine through this app, so the session cookie stays
// first-party. set ENGINE_PROXY_URL to the engine's public URL and leave the browser-side URL empty.
const proxy = process.env.ENGINE_PROXY_URL?.replace(/\/$/, '');

const config: NextConfig = {
  transpilePackages: ['@fork/shared', '@fork/domain-finance', '@fork/harness'],
  devIndicators: false,
  // the browser tests run their own dev server next to yours, so they need their own build folder
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  env: {
    NEXT_PUBLIC_ENGINE_URL: proxy
      ? ''
      : (process.env.NEXT_PUBLIC_ENGINE_URL ?? 'http://localhost:8790'),
  },
  async rewrites() {
    return proxy ? [{ source: '/api/:path*', destination: `${proxy}/api/:path*` }] : [];
  },
};

export default config;

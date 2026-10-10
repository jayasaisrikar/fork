import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@fork/shared', '@fork/domain-finance', '@fork/harness'],
  devIndicators: false,
  // the browser tests run their own dev server next to yours, so they need their own build folder
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
};

export default config;

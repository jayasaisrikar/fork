import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@fork/shared'],
  devIndicators: false,
};

export default config;

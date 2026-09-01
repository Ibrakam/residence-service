import type { NextConfig } from 'next';

const basePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';

const nextConfig: NextConfig = {
  basePath,
  assetPrefix: basePath,
  output: 'standalone',
};

export default nextConfig;

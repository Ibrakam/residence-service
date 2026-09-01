import type { NextConfig } from 'next';

const basePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const assetPrefix = process.env.NEXT_PUBLIC_ASSET_PREFIX ?? basePath;

const nextConfig: NextConfig = {
  basePath,
  assetPrefix,
  output: 'standalone',
};

export default nextConfig;

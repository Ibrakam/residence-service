import type { NextConfig } from 'next';

const basePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const assetPrefix = process.env.NEXT_PUBLIC_ASSET_PREFIX ?? basePath;

const nextConfig: NextConfig = {
  basePath,
  assetPrefix,
  images: {
    // The production vinext standalone does not expose Next's /_next/image
    // optimizer. Soy Bo‘yi already ships reviewed WebP derivatives, so serve
    // those files directly instead of generating broken optimizer URLs.
    unoptimized: true,
  },
  output: 'standalone',
};

export default nextConfig;

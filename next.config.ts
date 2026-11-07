import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['sharp', 'exifr'],
  // thumbnails/DB are runtime data, never part of the build
  outputFileTracingExcludes: { '*': ['data/**', 'backups/**', 'notes/**'] },
};

export default nextConfig;

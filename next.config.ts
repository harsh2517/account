
import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
    ],
  },
  // Add experimental.allowedDevOrigins to allowlist the development server's public URL
  experimental: {
    allowedDevOrigins: [
      // The origin causing the warning. Using a wildcard to support dynamic dev URLs.
      'https://*.cloudworkstations.dev',
      // It's also good practice to allowlist the standard localhost if you sometimes run/access it directly
      'http://localhost:9002', 
    ],
  },
};

export default nextConfig;

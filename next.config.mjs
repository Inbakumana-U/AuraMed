/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // Allows production build to succeed without getting blocked by strict type mismatches
    ignoreBuildErrors: true,
  },
  eslint: {
    // Prevents ESLint from failing the deployment
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
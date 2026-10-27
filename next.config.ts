/** @type {import('next').NextConfig} */
const nextConfig = {
  // Add this block to fix the 500 crash!
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
};

module.exports = nextConfig;
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Add this block to allow native SQLite bindings
  serverExternalPackages: ["sqlite3", "sqlite"],
};

export default nextConfig;
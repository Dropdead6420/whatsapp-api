const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // Emit a self-contained runtime bundle under .next/standalone for the
  // production Docker image. Slashes the runtime layer from ~500MB to ~150MB
  // by skipping node_modules and dev deps.
  output: "standalone",
  // The Dockerfile copies the build context relative to the monorepo root;
  // tell Next where the workspace root lives so it traces correctly.
  experimental: {
    outputFileTracingRoot: path.join(__dirname, "../../"),
  },
  transpilePackages: ["@nexaflow/shared", "@nexaflow/ui"],
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.modules = [
      path.resolve(__dirname, "node_modules"),
      ...(config.resolve.modules || []),
    ];
    return config;
  },
};

module.exports = nextConfig;

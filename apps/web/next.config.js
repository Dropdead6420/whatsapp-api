/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  transpilePackages: ["@nexaflow/shared", "@nexaflow/ui"],
};

export default nextConfig;

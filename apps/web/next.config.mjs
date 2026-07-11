/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @brandpilot/core is a source-only TS workspace package; Next must transpile it.
  transpilePackages: ['@brandpilot/core'],
  // The dashboard is a pure client of the NestJS API; no rewrites needed here.
  // NEXT_PUBLIC_API_URL is read directly by the fetch client in src/lib/api.ts.
};

export default nextConfig;

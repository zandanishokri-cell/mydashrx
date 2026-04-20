/** @type {import('next').NextConfig} */
// P-SEC29: CSP nonce migration — middleware.ts now handles per-request nonce injection
// This static header applies to paths not covered by middleware (static assets, etc.)
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=(), browsing-topics=(), interest-cohort=(), join-ad-interest-group=(), run-ad-auction=()' },
];

const config = {
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.r2.cloudflarestorage.com',
      },
    ],
  },
};

export default config;

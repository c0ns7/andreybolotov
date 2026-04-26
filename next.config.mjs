/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    externalDir: true,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:8787/api/:path*",
      },
      {
        source: "/ws",
        destination: "http://127.0.0.1:8787/ws",
      },
    ];
  },
};

export default nextConfig;

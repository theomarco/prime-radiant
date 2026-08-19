import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // In production the Python function is served by Vercel's filesystem phase.
    // Locally, next dev owns every route, so point /api/seldon at the standalone
    // runner in scripts/dev-seldon.py.
    if (process.env.NODE_ENV !== "development") return [];
    const port = process.env.SELDON_DEV_PORT ?? "3999";
    return [{ source: "/api/seldon", destination: `http://127.0.0.1:${port}/` }];
  },
};

export default nextConfig;

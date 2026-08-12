import type { NextConfig } from "next";

/**
 * Where the NestJS API actually lives. In development that is another port on
 * localhost; in production it is the Render service (and, later, the container
 * behind nginx on the VPS).
 */
const API_ORIGIN = (
  process.env.API_URL ?? "http://localhost:4001/api"
).replace(/\/api\/?$/, "");

const nextConfig: NextConfig = {
  /**
   * `/api/*` is served from this same domain and quietly forwarded to the API.
   *
   * This is not a convenience. Both auth tokens are `sameSite: "lax"` httpOnly
   * cookies, and a browser will not attach those to a request for a different
   * site — and `vercel.app` is on the Public Suffix List, so two Vercel
   * subdomains genuinely are different sites. Talking to the API on its own
   * domain would mean either no cookies at all, or `sameSite: "none"`, which
   * trades the app's CSRF protection away. One origin keeps both.
   *
   * It is also the same shape as the nginx config the VPS will use, so moving
   * there changes a hostname and nothing else.
   */
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;

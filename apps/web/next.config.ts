import type { NextConfig } from "next";

/**
 * Where the NestJS API actually lives. In development that is another port on
 * localhost; in production it is the Render service (and, later, the container
 * behind nginx on the VPS).
 */
const API_ORIGIN = (
  process.env.API_URL ?? "http://localhost:4001/api"
).replace(/\/api\/?$/, "");

/**
 * A wrong `API_URL` does not fail — it forwards. Every request, sign-in
 * included, goes wherever it points, and if that hostname happens to belong to
 * somebody else's service the passwords go with it. It already happened once
 * here: a placeholder hostname from the deployment notes turned out to be a
 * real, live service belonging to a stranger, and the only clue was an error
 * message in the wrong language.
 *
 * So the build refuses to produce a deployment that would do that again.
 */
if (process.env.NODE_ENV === "production") {
  if (!process.env.API_URL) {
    throw new Error(
      "API_URL is not set. The /api rewrite has nowhere to go — set it to your " +
        "own API's URL, ending in /api.",
    );
  }
  if (/YOUR-API-NAME|REPLACE-ME|example\.com/i.test(process.env.API_URL)) {
    throw new Error(
      `API_URL is still a placeholder (${process.env.API_URL}). Set it to your ` +
        "own deployed API, or every request — including sign-in — is sent to a " +
        "host you do not control.",
    );
  }
}

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

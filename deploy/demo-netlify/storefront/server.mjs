// Replaces the Nitro netlify preset entry. /v1/* is excluded so the _redirects
// proxy to the API wins, and every SSR response carries the demo noindex header.
import handler from "./main.mjs";

export default async (request, context) => {
  const response = await handler(request, context);
  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", "noindex, nofollow");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const config = {
  name: "server handler",
  generator: "nitro@",
  path: "/*",
  nodeBundler: "none",
  includedFiles: ["**"],
  excludedPath: ["/.netlify/*", "/v1/*"],
  preferStatic: true,
};

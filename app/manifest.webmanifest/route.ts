import storefrontManifest from "../storefront-manifest";

// Preserve the storefront URL and contents without a root file-based manifest:
// file-based metadata takes precedence over the admin page's scoped manifest.
export function GET() {
  return Response.json(storefrontManifest(), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

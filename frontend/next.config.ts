import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Moonshine's default WASM build uses SharedArrayBuffer (SIMD + threads),
  // which browsers only expose to cross-origin-isolated documents. Scoped to
  // the isolated feasibility route so the main workflow is unaffected.
  async headers() {
    return [
      {
        source: "/moonshine-test",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
      {
        // The Emscripten binding spawns module workers from this folder. Chrome
        // rejects worker scripts under COEP unless the script response also
        // carries COEP (blockedReason: coep-frame-resource-needs-coep-header);
        // CORP keeps the static assets explicitly cross-origin readable.
        source: "/moonshine-wasm/:path*",
        headers: [
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

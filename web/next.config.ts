import path from "node:path";
import type { NextConfig } from "next";

// SOT: next-config, standalone-output
// WHAT:  build settings for the Brandcast dashboard and TV client.
// WHY:   standalone output traces the modules actually imported, so the runtime
//        image ships a small server bundle instead of a full node_modules tree.
// HOW:   outputFileTracingRoot points at the workspace root because npm workspaces
//        hoist dependencies there. Next compiles this file to CJS, so it resolves
//        from process.cwd() rather than import.meta.url.
// WHERE: consumed by the Dockerfile build stage

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(process.cwd(), ".."),
  reactCompiler: true,
};

export default nextConfig;

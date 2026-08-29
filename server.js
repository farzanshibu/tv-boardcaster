// SOT: server-entrypoint, next-express-composition
// WHAT:  boots Next.js and hands it every non-API route on one HTTP server.
// WHY:   TV clients need a raw WebSocket upgrade, which Next alone does not serve,
//        so one Node process owns the API/WS plane and the Next request handler.
// HOW:   In production we consume the standalone build's traced output. That tree
//        deliberately omits webpack, so calling next({dev:false}) would crash on
//        config loading; getRequestHandlers() is the supported entry for it.
//        In development the normal next() path gives HMR.
// WHERE: API + WS live in src/server.js; the UI lives in web/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, server, attachNext, startBackgroundWork } from "./src/server.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT || 4000);
const webDir = path.join(ROOT, "web");

/**
 * Production uses the standalone bundle's own server plumbing; development uses
 * the full next() API. Returns an (req,res) handler either way.
 */
async function createNextHandler() {
  if (dev) {
    const { default: next } = await import("next");
    const nextApp = next({ dev: true, dir: webDir });
    await nextApp.prepare();
    return nextApp.getRequestHandler();
  }

  // The standalone bundle omits webpack, so loadConfig() would throw on import.
  // Next skips config loading entirely when this env var is set, which is exactly
  // what the generated standalone server does before requiring anything.
  const configPath = path.join(webDir, "standalone-config.json");
  const config = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, "utf8"))
    : undefined;
  if (config) process.env["__NEXT_PRIVATE_STANDALONE_CONFIG"] = JSON.stringify(config);

  const { getRequestHandlers } = await import("next/dist/server/lib/start-server.js");

  const handlers = await getRequestHandlers({
    dir: webDir,
    port,
    hostname: "0.0.0.0",
    dev: false,
    minimalMode: false,
    ...(config ? { config } : {}),
  });
  // Next has returned both a tuple and an object across versions; accept either.
  if (typeof handlers === "function") return handlers;
  if (Array.isArray(handlers)) return handlers[0];
  if (typeof handlers?.requestHandler === "function") return handlers.requestHandler;
  throw new Error("Next did not return a usable request handler");
}

const handler = await createNextHandler();
attachNext(handler);

await startBackgroundWork();

server.listen(port, () => {
  console.log(
    `Brandcast TV ${dev ? "(dev)" : "(production)"} on http://localhost:${port}` +
      `\n  dashboard  http://localhost:${port}/dashboard` +
      `\n  TV player  http://localhost:${port}/tv`,
  );
});

export { app };

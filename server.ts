// SOT: next-express-composition, production-entrypoint
// WHAT:  boots Next.js and hands it every route the data plane does not own.
// WHY:   TV clients need a raw WebSocket upgrade, which Next alone does not serve, so
//        one process owns the API/WS plane and the Next request handler.
// HOW:   in production we consume the standalone build's traced output. That tree
//        deliberately omits webpack, so calling next({dev:false}) would crash on
//        config loading; getRequestHandlers() is the supported entry for it.
//        In development the normal next() path gives HMR.
// WHERE: API + sockets in src/server.ts; the UI in web/

import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import { fileURLToPath } from 'node:url';
import { app, attachNext, server, startBackgroundWork } from './src/server.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT ?? 4000);
const webDir = path.join(ROOT, 'web');

type RequestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;

/**
 * Production uses the standalone bundle's own server plumbing; development uses the
 * full next() API. Returns an (req,res) handler either way.
 */
async function createNextHandler(): Promise<RequestHandler> {
  if (dev) {
    const { default: next } = await import('next');
    // Next 16 claims its own dev port (3000 by default) and writes .next/dev/lock
    // with it. Pin it to our port so a stray listener on 3000 cannot block boot.
    const nextApp = next({ dev: true, dir: webDir, port, hostname: 'localhost' });
    await nextApp.prepare();
    return nextApp.getRequestHandler() as RequestHandler;
  }

  // The standalone bundle omits webpack, so loadConfig() would throw on import.
  // Next skips config loading entirely when this env var is set, which is exactly
  // what the generated standalone server does before requiring anything.
  const configPath = path.join(webDir, 'standalone-config.json');
  const config = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>
    : undefined;
  if (config) process.env['__NEXT_PRIVATE_STANDALONE_CONFIG'] = JSON.stringify(config);

  const { getRequestHandlers } = await import('next/dist/server/lib/start-server.js');
  // Next has renamed this option across versions (`dev` then `isDev`); pass both and
  // let the build read whichever it knows.
  const handlers = await (getRequestHandlers as unknown as (o: Record<string, unknown>) => Promise<unknown>)({
    dir: webDir,
    port,
    hostname: '0.0.0.0',
    dev: false,
    isDev: false,
    minimalMode: false,
    ...(config ? { config } : {}),
  });

  // Next has returned both a tuple and an object across versions; accept either.
  if (typeof handlers === 'function') return handlers as RequestHandler;
  if (Array.isArray(handlers)) return handlers[0] as RequestHandler;
  const asObject = handlers as { requestHandler?: RequestHandler };
  if (typeof asObject?.requestHandler === 'function') return asObject.requestHandler;
  throw new Error('Next did not return a usable request handler');
}

attachNext(await createNextHandler());
await startBackgroundWork();

server.listen(port, () => {
  console.log(
    `Brandcast TV ${dev ? '(dev)' : '(production)'} on http://localhost:${port}` +
    `\n  dashboard  http://localhost:${port}/dashboard` +
    `\n  TV player  http://localhost:${port}/tv`,
  );
});

export { app };

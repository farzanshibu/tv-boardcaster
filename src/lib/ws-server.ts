// SOT: websocket-server-impl, bun-ws-workaround
// WHAT:  loads the real `ws` package rather than the runtime's built-in shim.
// WHY:   authorising a device needs a database round trip before the handshake
//        completes, and Bun's bundled `ws` can only finish an upgrade inside the tick
//        that raised it — a `handleUpgrade` after any I/O throws inside its own abort
//        path and kills the connection. The npm `ws` (already a dependency) handles a
//        deferred upgrade correctly, which is what lets a revoked device be refused
//        with a 401 instead of being accepted and then hung up on.
// HOW:   Bun aliases the bare specifier `ws`, and the package's exports map hides
//        `ws/index.js`, so resolve through `ws/package.json` — which the map does
//        expose — and import the file it names by absolute path.
// WHERE: used by src/server.ts for the device and dashboard sockets.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { WebSocketServer as WebSocketServerType } from 'ws';

type WsModule = { WebSocketServer: typeof WebSocketServerType };

async function loadWs(): Promise<WsModule> {
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve('ws/package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { main?: string };
    const entry = path.join(path.dirname(pkgPath), pkg.main ?? 'index.js');
    const mod = await import(pathToFileURL(entry).href) as Partial<WsModule>;
    if (typeof mod.WebSocketServer === 'function') return mod as WsModule;
  } catch (err) {
    console.warn(`[ws] falling back to the built-in implementation: ${(err as Error).message}`);
  }
  return import('ws') as Promise<WsModule>;
}

const ws = await loadWs();

export const WebSocketServer = ws.WebSocketServer;

import websocket from '@fastify/websocket';
import type { WsFrame } from '@tma/shared';
import type { AppContext } from '../context.js';
import type { AppServer } from './types.js';

interface HubSocket {
  send: (data: string) => void;
  on: (event: string, listener: () => void) => void;
}

const PING_INTERVAL_MS = 20_000;

export class WsHub {
  private readonly clients = new Set<HubSocket>();

  add(socket: HubSocket): void {
    this.clients.add(socket);
  }

  remove(socket: HubSocket): void {
    this.clients.delete(socket);
  }

  broadcast(frame: WsFrame): void {
    const payload = JSON.stringify(frame);
    for (const client of this.clients) {
      try {
        client.send(payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  get size(): number {
    return this.clients.size;
  }
}

export async function registerWs(
  app: AppServer,
  ctx: AppContext,
  hub: WsHub,
): Promise<void> {
  await app.register(websocket);

  app.get('/ws', { websocket: true }, (socket) => {
    const client = socket as unknown as HubSocket;
    hub.add(client);
    client.send(
      JSON.stringify({ type: 'hello', ts: Date.now(), version: '0.1.0' } satisfies WsFrame),
    );
    socket.on('close', () => hub.remove(client));
    ctx.logger.debug({ clients: hub.size }, 'WS 客户端接入');
  });

  const timer = setInterval(() => hub.broadcast({ type: 'ping', ts: Date.now() }), PING_INTERVAL_MS);
  app.addHook('onClose', async () => {
    clearInterval(timer);
  });
}

import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { URL } from 'url';
import { Logging } from 'homebridge';

interface SnapshotHttpServerOptions {
  host: string;
  port: number;
  token: string;
  log: Logging;
  getSnapshot: (uuid: string, height: number) => Promise<Buffer | undefined>;
}

export class SnapshotHttpServer {
  private readonly host: string;
  private readonly port: number;
  private readonly token: string;
  private readonly log: Logging;
  private readonly getSnapshot: (uuid: string, height: number) => Promise<Buffer | undefined>;
  private server?: Server;

  constructor(options: SnapshotHttpServerOptions) {
    this.host = options.host;
    this.port = options.port;
    this.token = options.token;
    this.log = options.log;
    this.getSnapshot = options.getSnapshot;
  }

  start(): void {
    if (this.server) {
      return;
    }

    this.server = createServer(this.handleRequest.bind(this));
    this.server.on('error', (err: Error) => {
      this.log.error(`Snapshot endpoint failed: ${err.message}`);
    });
    this.server.listen(this.port, this.host, () => {
      const address = this.server?.address();
      if (typeof address === 'object' && address) {
        this.log.info(`Snapshot endpoint listening on http://${this.host}:${(address as AddressInfo).port}/snapshot`);
      }
    });
  }

  stop(): void {
    this.server?.close();
    this.server = undefined;
  }

  async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (request.method !== 'GET' || !request.url) {
        this.sendText(response, 405, 'Method Not Allowed');
        return;
      }

      const url = new URL(request.url, `http://${this.host}`);
      if (url.pathname !== '/snapshot') {
        this.sendText(response, 404, 'Not Found');
        return;
      }

      if (!this.isAuthorized(request, url)) {
        this.sendText(response, 401, 'Unauthorized');
        return;
      }

      const uuid = url.searchParams.get('uuid') || '';
      const height = parseInt(url.searchParams.get('height') || '720', 10);
      const snapshot = await this.getSnapshot(uuid, Number.isNaN(height) ? 720 : height);

      if (!snapshot) {
        this.sendText(response, 404, 'Snapshot Not Found');
        return;
      }

      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'image/jpeg',
      });
      response.end(snapshot);
    } catch (err: any) {
      this.sendText(response, 500, err.message || 'Snapshot Error');
    }
  }

  private isAuthorized(request: IncomingMessage, url: URL): boolean {
    if (url.searchParams.get('token') === this.token) {
      return true;
    }

    const auth = request.headers?.authorization;
    return auth === `Bearer ${this.token}`;
  }

  private sendText(response: ServerResponse, status: number, message: string): void {
    response.writeHead(status, { 'Content-Type': 'text/plain' });
    response.end(message);
  }
}

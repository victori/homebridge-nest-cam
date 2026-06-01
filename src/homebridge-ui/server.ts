/* eslint-disable no-await-in-loop */
import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';
import { AddressInfo } from 'net';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { URL } from 'url';
import { auth, getCameras, generateToken, getRefreshToken } from '../nest/connection';
import { NestConfig } from '../nest/types/config';
import { Face, Member } from '../nest/types/structure';
import { NestStructure } from '../nest/structure';
import { CameraInfo, Zone } from '../nest/types/camera';
import { NestCam } from '../nest/cam';

interface Structure {
  title: string;
  enum: Array<string>;
}

interface SnapshotRequest {
  uuid: string;
  height?: number;
}

interface SnapshotResponse {
  contentType: string;
  data: string;
}

interface SnapshotEndpointResponse {
  url: string;
}

export class UiServer extends HomebridgePluginUiServer {
  private accessToken?: string;
  private cameras?: Array<CameraInfo>;
  private ft = false;
  private snapshotHttpServer?: Server;
  private snapshotHttpPort?: number;

  constructor() {
    super();

    this.onRequest('/logout', this.handleLogoutRequest.bind(this));
    this.onRequest('/auth', this.handleAuthRequest.bind(this));
    this.onRequest('/structures', this.handleStructureRequest.bind(this));
    this.onRequest('/cameras', this.handleCamerasRequest.bind(this));
    this.onRequest('/faces', this.handleFacesRequest.bind(this));
    this.onRequest('/zones', this.handleZonesRequest.bind(this));
    this.onRequest('/snapshot', this.handleSnapshotRequest.bind(this));
    this.onRequest('/snapshot-url', this.handleSnapshotEndpointRequest.bind(this));
    this.onRequest('/owner', this.handleOwnerRequest.bind(this));
    this.onRequest('/generateToken', this.handleGenerateTokenRequest.bind(this));
    this.onRequest('/getRefreshToken', this.handleGetRefreshTokenRequest.bind(this));

    this.startSnapshotHttpServer();
    this.ready();
  }

  private generateConfig(): NestConfig | undefined {
    if (this.accessToken) {
      const config: NestConfig = {
        platform: 'Nest-cam',
        fieldTest: this.ft,
        access_token: this.accessToken,
      };
      return config;
    }
  }

  async handleAuthRequest(payload: any): Promise<boolean> {
    this.accessToken = await auth(payload.refreshToken, payload.ft);
    this.ft = payload.ft;
    return this.accessToken ? true : false;
  }

  async handleStructureRequest(): Promise<Array<Structure> | undefined> {
    const config = this.generateConfig();

    if (config) {
      const structures: Array<Structure> = [];
      const cameras = this.cameras || (await getCameras(config));
      this.cameras = cameras;
      cameras.forEach((cameraInfo) => {
        const exists = structures.find((x) => x.enum[0] === cameraInfo.nest_structure_id.replace('structure.', ''));
        if (!exists) {
          structures.push({
            title: cameraInfo.nest_structure_name,
            enum: [cameraInfo.nest_structure_id.replace('structure.', '')],
          });
        }
      });
      return structures;
    }
  }

  async handleOwnerRequest(): Promise<Member | undefined> {
    const config = this.generateConfig();

    if (config) {
      const cameras = this.cameras || (await getCameras(config));
      this.cameras = cameras;
      if (cameras && cameras.length > 0) {
        const structure = new NestStructure(cameras[0], config);
        const members = await structure.getMembers();
        const owner = members.find((m) => m.roles.includes('owner'));
        return owner;
      }
    }
  }

  async handleCamerasRequest(): Promise<Array<CameraInfo> | undefined> {
    const config = this.generateConfig();
    if (config) {
      const cameras = this.cameras || (await getCameras(config));
      this.cameras = cameras;
      return cameras;
    }
  }

  async handleFacesRequest(): Promise<Array<Face> | undefined> {
    const config = this.generateConfig();
    if (config) {
      const structures: Array<NestStructure> = [];
      let faces: Array<Face> = [];
      const cameras = this.cameras || (await getCameras(config));
      for (const camera of cameras) {
        if (
          !structures.some(
            (structure: NestStructure) => structure.id === camera.nest_structure_id.replace('structure.', ''),
          )
        ) {
          structures.push(new NestStructure(camera, config));
        }
      }

      for (const structure of structures) {
        const newFaces = await structure.getFaces();
        if (newFaces) {
          faces = faces.concat(newFaces);
        }
      }
      return faces;
    }
  }

  async handleZonesRequest(): Promise<Array<Zone> | undefined> {
    const config = this.generateConfig();
    if (config) {
      let zones: Array<Zone> = [];
      const cameras = this.cameras || (await getCameras(config));
      for (const camera of cameras) {
        const cam = new NestCam(config, camera);
        const newZones = await cam.getZones();
        if (newZones) {
          zones = zones.concat(newZones);
        }
      }
      return zones;
    }
  }

  async handleSnapshotRequest(payload: SnapshotRequest): Promise<SnapshotResponse | undefined> {
    const snapshot = await this.getSnapshot(payload);
    if (snapshot) {
      return {
        contentType: 'image/jpeg',
        data: snapshot.toString('base64'),
      };
    }
  }

  async handleSnapshotEndpointRequest(payload: SnapshotRequest): Promise<SnapshotEndpointResponse | undefined> {
    if (this.snapshotHttpPort) {
      const url = new URL(`http://127.0.0.1:${this.snapshotHttpPort}/snapshot`);
      url.searchParams.set('uuid', payload.uuid);
      url.searchParams.set('height', `${payload.height || 720}`);
      return {
        url: url.toString(),
      };
    }
  }

  async handleSnapshotHttpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (request.method !== 'GET' || !request.url) {
        response.writeHead(405, { 'Content-Type': 'text/plain' });
        response.end('Method Not Allowed');
        return;
      }

      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname !== '/snapshot') {
        response.writeHead(404, { 'Content-Type': 'text/plain' });
        response.end('Not Found');
        return;
      }

      const uuid = url.searchParams.get('uuid') || '';
      const height = parseInt(url.searchParams.get('height') || '720', 10);
      const snapshot = await this.getSnapshot({
        uuid,
        height: Number.isNaN(height) ? 720 : height,
      });

      if (!snapshot) {
        response.writeHead(404, { 'Content-Type': 'text/plain' });
        response.end('Snapshot Not Found');
        return;
      }

      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'image/jpeg',
      });
      response.end(snapshot);
    } catch (err: any) {
      response.writeHead(500, { 'Content-Type': 'text/plain' });
      response.end(err.message || 'Snapshot Error');
    }
  }

  private async getSnapshot(payload: SnapshotRequest): Promise<Buffer | undefined> {
    const config = this.generateConfig();
    if (config) {
      const cameras = this.cameras || (await getCameras(config));
      this.cameras = cameras;
      const cameraInfo = cameras.find((camera) => camera.uuid === payload.uuid);
      if (cameraInfo) {
        const camera = new NestCam(config, cameraInfo);
        return await camera.getSnapshot(payload.height || 720);
      }
    }
  }

  private startSnapshotHttpServer(): void {
    if (!process.send || process.env.NODE_ENV === 'test') {
      return;
    }

    this.snapshotHttpServer = createServer(this.handleSnapshotHttpRequest.bind(this));
    this.snapshotHttpServer.listen(0, '127.0.0.1', () => {
      const address = this.snapshotHttpServer?.address();
      if (typeof address === 'object' && address) {
        this.snapshotHttpPort = (address as AddressInfo).port;
        console.log(`Snapshot endpoint listening on http://127.0.0.1:${this.snapshotHttpPort}/snapshot`);
      }
    });
  }

  async handleLogoutRequest(): Promise<void> {
    this.cameras = undefined;
  }

  private async sendToParent(request: { action: string; payload?: any }): Promise<any> {
    const promise = new Promise((resolve) => {
      this.onRequest(`/${request.action}`, async (payload: any): Promise<any> => {
        return resolve(payload);
      });
    });
    this.pushEvent(request.action, request.payload);
    return promise;
  }

  async setCredentials(credentials: string): Promise<void> {
    await this.sendToParent({ action: 'credentials', payload: credentials });
  }

  async showError(msg: string): Promise<void> {
    await this.sendToParent({
      action: 'error',
      payload: msg,
    });
  }

  async handleGenerateTokenRequest(payload: any): Promise<string> {
    return generateToken(payload.ft);
  }

  async handleGetRefreshTokenRequest(payload: any): Promise<string> {
    if (!payload.code) {
      return '';
    }
    try {
      return await getRefreshToken(payload.code, payload.ft);
    } catch (err: any) {
      let msg = err;
      if (err.response?.data?.error_description) {
        msg = err.response?.data?.error_description;
      } else if (err.message) {
        msg = err.message;
      }
      await this.showError(msg);
    }
    return '';
  }
}

// start the instance of the class
((): UiServer => {
  return new UiServer();
})();

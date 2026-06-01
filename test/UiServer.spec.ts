jest.mock('@homebridge/plugin-ui-utils', () => ({
  HomebridgePluginUiServer: class {
    onRequest = jest.fn();
    pushEvent = jest.fn();
    ready = jest.fn();
  },
}));

const getCameras = jest.fn();
jest.mock('../src/nest/connection', () => ({
  auth: jest.fn(),
  generateToken: jest.fn(),
  getCameras: (...args: Array<any>) => getCameras(...args),
  getRefreshToken: jest.fn(),
}));

const getSnapshot = jest.fn();
const NestCam = jest.fn(function () {
  return {
    getSnapshot,
  };
});
jest.mock('../src/nest/cam', () => ({
  NestCam,
}));

import { UiServer } from '../src/homebridge-ui/server';

describe('UiServer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers a snapshot request endpoint', () => {
    const server = new UiServer();

    expect(server.onRequest).toHaveBeenCalledWith('/snapshot', expect.any(Function));
    expect(server.onRequest).toHaveBeenCalledWith('/snapshot-url', expect.any(Function));
  });

  it('returns a base64-encoded JPEG snapshot for the requested camera', async () => {
    const camera = {
      uuid: 'camera-1',
      name: 'Front Door',
    };
    getCameras.mockResolvedValue([camera]);
    getSnapshot.mockResolvedValue(Buffer.from('jpeg bytes'));
    const server = new UiServer();
    (server as any).accessToken = 'access-token';

    const response = await server.handleSnapshotRequest({ uuid: 'camera-1', height: 720 });

    expect(response).toEqual({
      contentType: 'image/jpeg',
      data: Buffer.from('jpeg bytes').toString('base64'),
    });
    expect(NestCam).toHaveBeenCalledWith(
      {
        platform: 'Nest-cam',
        fieldTest: false,
        access_token: 'access-token',
      },
      camera,
    );
    expect(getSnapshot).toHaveBeenCalledWith(720);
  });

  it('returns JPEG bytes from the HTTP snapshot endpoint', async () => {
    const camera = {
      uuid: 'camera-1',
      name: 'Front Door',
    };
    const jpeg = Buffer.from('jpeg bytes');
    getCameras.mockResolvedValue([camera]);
    getSnapshot.mockResolvedValue(jpeg);
    const server = new UiServer();
    (server as any).accessToken = 'access-token';
    const response = {
      writeHead: jest.fn(),
      end: jest.fn(),
    };

    await server.handleSnapshotHttpRequest(
      {
        method: 'GET',
        url: '/snapshot?uuid=camera-1&height=720',
      } as any,
      response as any,
    );

    expect(response.writeHead).toHaveBeenCalledWith(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'image/jpeg',
    });
    expect(response.end).toHaveBeenCalledWith(jpeg);
  });
});

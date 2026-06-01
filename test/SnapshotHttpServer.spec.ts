import { SnapshotHttpServer } from '../src/snapshot-server';

function createResponse(): any {
  return {
    writeHead: jest.fn(),
    end: jest.fn(),
  };
}

describe('SnapshotHttpServer', () => {
  it('returns JPEG bytes for an authorized snapshot request', async () => {
    const jpeg = Buffer.from('jpeg bytes');
    const getSnapshot = jest.fn().mockResolvedValue(jpeg);
    const server = new SnapshotHttpServer({
      host: '0.0.0.0',
      port: 50525,
      token: 'secret',
      getSnapshot,
      log: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as any,
    });
    const response = createResponse();

    await server.handleRequest(
      {
        method: 'GET',
        url: '/snapshot?uuid=camera-1&height=720&token=secret',
      } as any,
      response,
    );

    expect(getSnapshot).toHaveBeenCalledWith('camera-1', 720);
    expect(response.writeHead).toHaveBeenCalledWith(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'image/jpeg',
    });
    expect(response.end).toHaveBeenCalledWith(jpeg);
  });

  it('rejects requests with a missing token', async () => {
    const getSnapshot = jest.fn();
    const server = new SnapshotHttpServer({
      host: '0.0.0.0',
      port: 50525,
      token: 'secret',
      getSnapshot,
      log: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as any,
    });
    const response = createResponse();

    await server.handleRequest(
      {
        method: 'GET',
        url: '/snapshot?uuid=camera-1&height=720',
      } as any,
      response,
    );

    expect(getSnapshot).not.toHaveBeenCalled();
    expect(response.writeHead).toHaveBeenCalledWith(401, { 'Content-Type': 'text/plain' });
    expect(response.end).toHaveBeenCalledWith('Unauthorized');
  });
});

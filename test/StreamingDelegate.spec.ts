import { StreamingDelegate } from '../src/streaming-delegate';

jest.mock('../src/ffmpeg', () => ({
  getCodecsOutput: jest.fn().mockResolvedValue('libx264 h264_vaapi libfdk_aac libspeex'),
  isFfmpegInstalled: jest.fn().mockResolvedValue(true),
  FfmpegProcess: jest.fn(),
}));

jest.mock('ffmpeg-for-homebridge', () => 'ffmpeg');

function makeDelegate(ffmpegCodec: string): StreamingDelegate {
  return new StreamingDelegate(
    {
      CameraController: {
        generateSynchronisationSource: jest.fn().mockReturnValue(1),
      },
    } as any,
    {
      info: {
        properties: {
          'streaming.enabled': true,
        },
      },
    } as any,
    {
      options: {
        ffmpegCodec,
      },
    } as any,
    {
      debug: jest.fn(),
      error: jest.fn(),
    } as any,
  );
}

function addPendingSession(delegate: StreamingDelegate): void {
  (delegate as any).pendingSessions.testSession = {
    address: '127.0.0.1',
    videoPort: 5000,
    returnVideoPort: 5001,
    videoSRTP: Buffer.from('video'),
    videoSSRC: 1234,
  };
}

describe('StreamingDelegate', () => {
  describe('getVideoCommand', () => {
    it('uploads frames to VAAPI when h264_vaapi is selected', () => {
      const delegate = makeDelegate('h264_vaapi');
      addPendingSession(delegate);
      (delegate as any).ffmpegCodec = 'h264_vaapi';

      const command = (delegate as any).getVideoCommand(
        {
          max_bit_rate: 299,
          pt: 99,
          mtu: 1200,
        },
        'testSession',
      );

      expect(command).toEqual(
        expect.arrayContaining(['-vaapi_device', '/dev/dri/renderD128', '-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi']),
      );
      expect(command).not.toEqual(expect.arrayContaining(['-pix_fmt', 'yuv420p']));
      expect(command).not.toEqual(expect.arrayContaining(['-preset', 'ultrafast', '-tune', 'zerolatency']));
    });

    it('keeps the existing libx264 low-latency software encoder flags', () => {
      const delegate = makeDelegate('libx264');
      addPendingSession(delegate);

      const command = (delegate as any).getVideoCommand(
        {
          max_bit_rate: 299,
          pt: 99,
          mtu: 1200,
        },
        'testSession',
      );

      expect(command).toEqual(expect.arrayContaining(['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency']));
      expect(command).toEqual(expect.arrayContaining(['-pix_fmt', 'yuv420p']));
    });
  });
});

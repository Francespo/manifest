import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AgentKeyAuthGuard } from '../../../otlp/guards/agent-key-auth.guard';
import { ProxyExceptionFilter } from '../../proxy/proxy-exception.filter';
import { AudioController } from '../audio.controller';
import { AudioService } from '../audio.service';

const ctx = { tenantId: 't1', agentId: 'a1', agentName: 'agent', userId: 'u1' };

describe('AudioController (HTTP)', () => {
  let app: INestApplication;
  const service = { handle: jest.fn(), taskStatus: jest.fn() };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [AudioController],
      providers: [{ provide: AudioService, useValue: service }],
    })
      .overrideGuard(AgentKeyAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => Record<string, unknown> };
        }) => {
          context.switchToHttp().getRequest()['ingestionContext'] = ctx;
          return true;
        },
      })
      .overrideFilter(ProxyExceptionFilter)
      .useValue({ catch: () => undefined })
      .compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    service.handle.mockReset();
    service.taskStatus.mockReset();
  });

  it('POST /v1/audio/transcriptions forwards the multipart file and form fields', async () => {
    service.handle.mockResolvedValue({ status: 200, body: { text: 'ciao' } });

    const res = await request(app.getHttpServer())
      .post('/v1/audio/transcriptions')
      .field('model', 'groq/whisper-large-v3')
      .field('response_format', 'verbose_json')
      .attach('file', Buffer.from('audio'), { filename: 'clip.mp3', contentType: 'audio/mpeg' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ text: 'ciao' });
    expect(service.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        apiMode: 'transcriptions',
        ctx,
        body: expect.objectContaining({ model: 'groq/whisper-large-v3' }),
        file: expect.objectContaining({ filename: 'clip.mp3', size: 5 }),
      }),
    );
  });

  it('POST /v1/audio/translations forwards as the translations surface', async () => {
    service.handle.mockResolvedValue({ status: 200, body: { text: 'hello' } });

    const res = await request(app.getHttpServer())
      .post('/v1/audio/translations')
      .field('model', 'groq/whisper-large-v3')
      .attach('file', Buffer.from('audio'), 'clip.mp3');

    expect(res.status).toBe(200);
    expect(service.handle).toHaveBeenCalledWith(expect.objectContaining({ apiMode: 'translations' }));
  });

  it('passes the async header through to the service', async () => {
    service.handle.mockResolvedValue({ status: 200, body: { id: 'atr_1' } });

    await request(app.getHttpServer())
      .post('/v1/audio/transcriptions')
      .set('X-Manifest-Async', 'true')
      .field('model', 'groq/whisper-large-v3')
      .attach('file', Buffer.from('audio'), 'clip.mp3');

    expect(service.handle).toHaveBeenCalledWith(expect.objectContaining({ async: true }));
  });

  it('GET /v1/audio/transcriptions/:id polls a stored task', async () => {
    service.taskStatus.mockResolvedValue({ status: 200, body: { id: 'atr_1', status: 'completed' } });

    const res = await request(app.getHttpServer()).get('/v1/audio/transcriptions/atr_1');

    expect(res.status).toBe(200);
    expect(service.taskStatus).toHaveBeenCalledWith(ctx, 'atr_1');
  });

  it('GET /v1/audio/translations/:id serves the same task surface', async () => {
    service.taskStatus.mockResolvedValue({ status: 200, body: { id: 'atr_1', status: 'completed' } });

    const res = await request(app.getHttpServer()).get('/v1/audio/translations/atr_1');

    expect(res.status).toBe(200);
    expect(service.taskStatus).toHaveBeenCalledWith(ctx, 'atr_1');
  });
});

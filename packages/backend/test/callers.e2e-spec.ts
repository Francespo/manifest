import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { v4 as uuid } from 'uuid';
import request from 'supertest';
import { createTestApp, TEST_API_KEY, TEST_TENANT_ID, TEST_AGENT_ID } from './helpers';

let app: INestApplication;

beforeAll(async () => {
  app = await createTestApp();

  const ds = app.get(DataSource);
  const now = new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);

  const insert = async (attribution: unknown, tokens: number, cost: number) => {
    await ds.query(
      `INSERT INTO agent_messages (id, tenant_id, agent_id, timestamp, status, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, agent_name, user_id, caller_attribution, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuid(),
        TEST_TENANT_ID,
        TEST_AGENT_ID,
        now,
        'ok',
        'gpt-4o',
        tokens,
        tokens,
        0,
        0,
        'test-agent',
        'test-user-001',
        attribution == null ? null : JSON.stringify(attribution),
        cost,
      ],
    );
  };

  await insert(
    { sdk: 'openai-js', sdkVersion: '6.26.0', appName: 'OpenClaw', appUrl: 'https://openclaw.ai' },
    100,
    0.01,
  );
  await insert(
    { sdk: 'openai-js', sdkVersion: '6.26.0', appName: 'OpenClaw', appUrl: 'https://openclaw.ai' },
    200,
    0.02,
  );
  await insert({ sdk: 'curl', sdkVersion: '8.14.1', userAgent: 'curl/8.14.1' }, 50, 0.001);
  await insert(null, 10, 0);
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/v1/callers', () => {
  it('groups callers by app_name/app_url/sdk and returns aggregates', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/callers?range=24h')
      .set('x-api-key', TEST_API_KEY)
      .expect(200);

    expect(res.body).toHaveProperty('callers');
    expect(res.body).toHaveProperty('sdks');
    expect(res.body).toHaveProperty('total_messages');
    expect(res.body).toHaveProperty('attributed_messages');

    expect(res.body.total_messages).toBeGreaterThanOrEqual(4);
    expect(res.body.attributed_messages).toBeGreaterThanOrEqual(3);

    const openclaw = res.body.callers.find((c: { app_name: string | null }) => c.app_name === 'OpenClaw');
    expect(openclaw).toBeDefined();
    expect(openclaw.sdk).toBe('openai-js');
    expect(openclaw.app_url).toBe('https://openclaw.ai');
    expect(openclaw.message_count).toBeGreaterThanOrEqual(2);
    expect(openclaw.input_tokens).toBeGreaterThanOrEqual(300);

    const curlSdk = res.body.sdks.find((s: { sdk: string | null }) => s.sdk === 'curl');
    expect(curlSdk).toBeDefined();
    expect(curlSdk.message_count).toBeGreaterThanOrEqual(1);
  });

  it('accepts agent_name filter', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/callers?range=24h&agent_name=test-agent')
      .set('x-api-key', TEST_API_KEY)
      .expect(200);

    expect(res.body.callers.length).toBeGreaterThan(0);
  });

  it('returns empty aggregates for an unknown agent', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/callers?range=24h&agent_name=no-such-agent')
      .set('x-api-key', TEST_API_KEY)
      .expect(200);

    expect(res.body.total_messages).toBe(0);
    expect(res.body.callers).toHaveLength(0);
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/api/v1/callers?range=24h').expect(401);
  });
});

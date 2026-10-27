import './runtime-env.mjs';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { Kafka, logLevel } from 'kafkajs';
import { eventSchema } from '../dist/core/routes/treasury/types/treasury-event.types.js';
import { MAX_EVENT_BYTES } from '../dist/helpers/capacity.helpers.js';

const programs = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
const tenantId = 'demo-tenant';

export function createDemoServer({
  enabled,
  apiUrl,
  producer,
  topic,
  allowedPrograms = programs,
  allowedTenant = tenantId,
}) {
  return createServer(async (request, response) => {
    const send = (status, body) => {
      response.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      response.end(JSON.stringify(body));
    };

    try {
      if (!enabled)
        return send(404, {
          success: false,
          error: { code: 404000, message: 'Local demo tools are disabled' },
        });

      const url = new URL(request.url, 'http://demo-tools');
      const match = /^\/demo-api\/programs\/([a-f0-9-]{36})\/(config|events)$/.exec(url.pathname);

      if (!match || !allowedPrograms.includes(match[1]))
        return send(404, {
          success: false,
          error: { code: 404000, message: 'Demo program not found' },
        });

      const [, programId, action] = match;

      if (
        (action === 'config' && request.method !== 'GET') ||
        (action === 'events' && request.method !== 'POST')
      )
        return send(405, {
          success: false,
          error: { code: 405000, message: 'Method not allowed' },
        });

      const authorization = request.headers.authorization;

      if (!authorization?.startsWith('Bearer '))
        return send(401, {
          success: false,
          error: { code: 401000, message: 'Authentication required' },
        });

      // The core checks the live PostgreSQL session, tenant and TREASURY permission on this exact resource.
      const access = await fetch(
        `${apiUrl}/api/v1/internal/programs/${programId}/reconciliation-view`,
        {
          headers: { authorization },
          signal: AbortSignal.timeout(10000),
        },
      );

      if (!access.ok) return send(access.status, await access.json());

      if (action === 'config')
        return send(200, {
          success: true,
          data: { tenantId: allowedTenant, programId, enabled: true },
        });

      if (!request.headers['content-type']?.startsWith('application/json'))
        return send(415, {
          success: false,
          error: { code: 415000, message: 'JSON content type required' },
        });

      const body = await new Promise((resolve, reject) => {
        let size = 0,
          overflow = false;
        const chunks = [];

        request.on('data', (chunk) => {
          size += chunk.length;
          if (overflow) return;

          if (size > MAX_EVENT_BYTES) {
            overflow = true;
            chunks.length = 0;
            send(413, {
              success: false,
              error: { code: 413000, message: 'Snapshot exceeds 2 MiB' },
            });
            resolve(null);

            return;
          }

          chunks.push(chunk);
        });
        request.on('end', () => resolve(overflow ? null : Buffer.concat(chunks)));
        request.on('error', reject);
      });

      if (body === null) return;

      let input;

      try {
        input = JSON.parse(body.toString('utf8'));
      } catch {
        return send(422, {
          success: false,
          error: { code: 422000, message: 'Invalid JSON' },
        });
      }

      const parsed = eventSchema.safeParse(input);

      if (
        !parsed.success ||
        parsed.data.programId !== programId ||
        parsed.data.tenantId !== allowedTenant
      )
        return send(422, {
          success: false,
          error: {
            code: 422000,
            message: 'Invalid demo event or resource scope',
          },
        });

      const event = parsed.data;

      await producer.send({
        topic,
        messages: [
          {
            key: `${allowedTenant}:${programId}`,
            value: JSON.stringify(event),
          },
        ],
      });
      send(202, {
        success: true,
        data: { eventId: event.eventId, status: 'Published' },
      });
    } catch {
      send(503, {
        success: false,
        error: {
          code: 503000,
          message: 'Demo infrastructure temporarily unavailable; retry the same event',
        },
      });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const producer = new Kafka({
    clientId: 'capacity-local-demo',
    brokers: (process.env.KAFKA_BROKERS ?? 'kafka:9092').split(','),
    logLevel: logLevel.ERROR,
  }).producer({ allowAutoTopicCreation: false });
  const enabled = process.env.LOCAL_DEMO_ENABLED === 'true';

  if (enabled) await producer.connect();

  const server = createDemoServer({
    enabled,
    producer,
    apiUrl: process.env.API_URL ?? 'http://app:3000',
    topic: process.env.KAFKA_TOPIC ?? 'treasury.capacity.v1',
  });

  server.listen(Number(process.env.DEMO_PORT ?? 3001), '0.0.0.0');
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      server.close(async () => {
        await producer.disconnect();
      });
      server.closeIdleConnections();
    });
}

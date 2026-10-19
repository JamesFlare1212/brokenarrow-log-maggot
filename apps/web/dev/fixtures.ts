import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

export function browserFixtures(): Plugin {
  let fixtures: Awaited<ReturnType<(typeof import('../../server/src'))['createBrowserFixtures']>>;
  return {
    name: 'browser-fixtures',
    apply: 'serve',
    async configureServer(server) {
      const require = createRequire(import.meta.url);
      // Vite restarts in the same process; pick up rebuilt server contracts.
      delete require.cache[require.resolve('../../server/dist/index.cjs')];
      const { createBrowserFixtures } =
        require('../../server/dist/index.cjs') as typeof import('../../server/src');
      const packagePath = fileURLToPath(new URL('../../../package.json', import.meta.url));
      const version = () =>
        (JSON.parse(readFileSync(packagePath, 'utf8')) as { version: string }).version;
      fixtures = await createBrowserFixtures(
        fileURLToPath(new URL('../../../tests/fixtures/real', import.meta.url)),
        fileURLToPath(new URL('../../../.test-data/web-dev', import.meta.url)),
        version,
        (event) => server.ws.send('ba:fixture-event', event),
      );
      server.watcher.add(packagePath);
      const reloadVersion = (path: string) => {
        if (resolve(path) === packagePath) server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('change', reloadVersion);
      server.httpServer?.once('close', () => server.watcher.off('change', reloadVersion));
      server.config.logger.info(`Browser fixture profile: ${fixtures.directory}`);
      server.middlewares.use('/__fixtures/rpc', async (request, response) => {
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        if (
          request.method !== 'POST' ||
          !request.headers['content-type']?.startsWith('application/json') ||
          (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`)
        ) {
          response.statusCode = 403;
          response.end(JSON.stringify({ error: 'Expected a same-origin JSON POST' }));
          return;
        }
        try {
          const chunks: Buffer[] = [];
          let length = 0;
          for await (const chunk of request) {
            const bytes = Buffer.from(chunk);
            length += bytes.length;
            if (length > 1024 * 1024) throw new Error('Request too large');
            chunks.push(bytes);
          }
          const { method, input } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          response.end(JSON.stringify({ value: await fixtures.invoke(method, input) }));
        } catch (error) {
          response.statusCode = 400;
          response.end(
            JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
          );
        }
      });
    },
    async buildEnd() {
      await fixtures?.stop();
    },
  };
}

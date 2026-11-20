import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { loadSource } from './source.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const webRequire = createRequire(resolve(root, 'apps/web/package.json'));
const { default: tailwindcss } = await import(
  pathToFileURL(webRequire.resolve('@tailwindcss/vite')).href
);
const output = resolve(root, '.test-data/previews/timeline.html');
const source = loadSource();
const result = await build({
  configFile: false,
  root,
  plugins: [
    {
      name: 'isolate-timeline-styles',
      enforce: 'pre',
      transform(source, id) {
        if (!id.replaceAll('\\', '/').endsWith('/apps/web/src/styles/index.css')) return;
        return source
          .replace(
            "@import 'tailwindcss';",
            [
              "@import 'tailwindcss' source(none);",
              ...[
                'button',
                'card',
                'chart',
                'toggle',
                'toggle-group',
                'slider',
                'separator',
                'native-select',
                'popover',
                'empty',
                'dialog',
                'table',
                'tooltip',
                'collapsible',
              ].map((name) => `@source '../components/ui/${name}.tsx';`),
              "@source '../lib/surfaces.ts';",
              "@source '../../../../docs/prototypes/timeline';",
            ].join('\n'),
          )
          .replace("@import './layout.css';", '')
          .replace("@import '@fontsource-variable/geist';", '');
      },
    },
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': resolve(root, 'apps/web/src'),
      'lucide-react': webRequire.resolve('lucide-react'),
      recharts: webRequire.resolve('recharts'),
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    __TIMELINE_SOURCE__: JSON.stringify(source),
  },
  build: {
    write: false,
    minify: true,
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL('./TimelinePreview.tsx', import.meta.url)),
      name: 'TimelinePreview',
      formats: ['iife'],
    },
  },
});
const chunks = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output);
const js = chunks
  .filter((item) => item.type === 'chunk')
  .map((item) => item.code)
  .join('\n');
const css = chunks
  .filter((item) => item.type === 'asset' && item.fileName.endsWith('.css'))
  .map((item) => item.source)
  .join('\n');
if (!js || !css) throw new Error('Missing prototype assets.');
const html = `<!doctype html><html lang="zh-CN" class="dark" data-mode="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BARadar Timeline</title><style>${css}</style></head><body><div id="root"></div><script>${js.replaceAll('</script', '<\\/script')}</script></body></html>`;
await mkdir(resolve(root, '.test-data/previews'), { recursive: true });
await writeFile(output, html);
await writeFile(
  resolve(root, '.test-data/previews/timeline-source.json'),
  JSON.stringify(source, null, 2),
);
console.log(`Self-contained preview: ${output} (${Buffer.byteLength(html)} bytes)`);

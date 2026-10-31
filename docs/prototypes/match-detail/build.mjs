import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = resolve(root, '.test-data/previews/match-detail.html');
const result = await build({
  configFile: false,
  root,
  plugins: [
    {
      name: 'isolate-prototype-styles',
      enforce: 'pre',
      transform(source, id) {
        if (!id.replaceAll('\\', '/').endsWith('/apps/web/src/styles/index.css')) return;
        // Retain application tokens; omit application-shell layout and font files.
        return source
          .replace(
            "@import 'tailwindcss';",
            [
              "@import 'tailwindcss' source(none);",
              ...[
                'button',
                'badge',
                'card',
                'separator',
                'table',
                'tabs',
                'toggle',
                'toggle-group',
                'tooltip',
                'popover',
              ].map((name) => `@source '../components/ui/${name}.tsx';`),
              "@source '../../../../docs/prototypes/match-detail/MatchDetailPreview.tsx';",
            ].join('\n'),
          )
          .replace("@import './layout.css';", '')
          .replace("@import '@fontsource-variable/geist';", '');
      },
    },
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { '@': resolve(root, 'apps/web/src') } },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    write: false,
    minify: true,
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL('./MatchDetailPreview.tsx', import.meta.url)),
      name: 'MatchDetailPreview',
      formats: ['iife'],
    },
  },
});
const chunks = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output);
const javascript = chunks
  .filter((item) => item.type === 'chunk')
  .map((item) => item.code)
  .join('\n');
const css = chunks
  .filter((item) => item.type === 'asset' && item.fileName.endsWith('.css'))
  .map((item) => item.source)
  .join('\n');
if (!javascript || !css) throw new Error('The prototype requires both JavaScript and CSS.');
const html = `<!doctype html><html lang="zh-CN" class="dark" data-mode="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>BARadar — Match detail design preview</title><style>${css}</style></head><body><div id="root"></div><script>${javascript.replaceAll('</script', '<\\/script')}</script></body></html>`;
await mkdir(resolve(root, '.test-data/previews'), { recursive: true });
await writeFile(output, html);
console.log(`Self-contained preview: ${output}`);
console.log(`HTML size: ${Buffer.byteLength(html)} bytes`);

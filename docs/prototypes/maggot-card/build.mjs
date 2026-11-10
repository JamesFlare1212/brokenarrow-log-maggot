import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const webRequire = createRequire(new URL('../../../apps/web/package.json', import.meta.url));
const { default: tailwindcss } = await import(
  pathToFileURL(webRequire.resolve('@tailwindcss/vite')).href
);
const contextual = process.argv.includes('--context');
const entry = contextual ? 'ProfileLayoutPreview.tsx' : 'MaggotCardPreview.tsx';
const output = resolve(root, `.test-data/previews/maggot-card${contextual ? '-context' : ''}.html`);
const layout = readFileSync(resolve(root, 'apps/web/src/styles/layout.css'), 'utf8');
const layoutVariables = contextual
  ? [
      layout.match(/:root\s*\{[^}]*\}/)?.[0],
      layout.match(/\.profile-analysis-grid\s*\{[^}]*\}/)?.[0],
    ].join('\n')
  : '';
const result = await build({
  configFile: false,
  root,
  plugins: [
    {
      name: 'isolate-card-prototype',
      enforce: 'pre',
      transform(source, id) {
        if (contextual && id.replaceAll('\\', '/').endsWith('/features/players/MaggotCard.tsx'))
          return "export { ContextMaggotCard as MaggotCard } from '@preview/maggot-concepts';";
        if (!id.replaceAll('\\', '/').endsWith('/apps/web/src/styles/index.css')) return;
        // Keep shared theme tokens; the inline preview host owns its transparent page foundation.
        return (
          source
            .replace(
              "@import 'tailwindcss';",
              [
                "@import 'tailwindcss' source(none);",
                "@source '../components/ui';",
                "@source '../components/ui.tsx';",
                "@source '../components/Tooltip.tsx';",
                "@source '../components/OverflowHint.tsx';",
                "@source '../lib/surfaces.ts';",
                ...(contextual
                  ? [
                      "@source '../features/players/ProfileOverview.tsx';",
                      "@source '../features/players/PlayerPreferences.tsx';",
                      "@source '../features/players/RatingTrendChart.tsx';",
                    ]
                  : []),
                "@source '../../../../docs/prototypes/maggot-card';",
              ].join('\n'),
            )
            .replace("@import './layout.css';", '')
            .replace("@import '@fontsource-variable/geist';", '')
            .replace('@apply bg-background text-foreground;', '@apply text-foreground;') +
          '\n' +
          layoutVariables
        );
      },
    },
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': resolve(root, 'apps/web/src'),
      'lucide-react': resolve(root, 'apps/web/node_modules/lucide-react'),
      '@ba/contracts': resolve(root, 'packages/contracts/src/index.ts'),
      '@ba/shared': resolve(root, 'packages/shared/src/index.ts'),
      '@preview/maggot-concepts': resolve(
        root,
        'docs/prototypes/maggot-card/MaggotCardConcepts.tsx',
      ),
    },
  },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    write: false,
    minify: true,
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL(entry, import.meta.url)),
      name: 'MaggotCardPreview',
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
if (!javascript || !css) throw new Error('The prototype requires JavaScript and CSS.');
// The contextual chart bundle exceeds the inline host limit without compression.
const payload = contextual ? gzipSync(JSON.stringify({ javascript, css })).toString('base64') : '';
const script = contextual
  ? `(async()=>{const bytes=Uint8Array.from(atob('${payload}'),value=>value.charCodeAt(0));const bundle=JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());const style=document.createElement('style');style.textContent=bundle.css;document.head.append(style);const script=document.createElement('script');script.textContent=bundle.javascript;document.body.append(script)})().catch(error=>{document.getElementById('root').textContent='Preview could not load.';throw error})`
  : javascript;
const html = `<!doctype html><html lang="zh-CN" class="dark" data-mode="dark" style="font-size:16px"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>BARadar — Maggot Index card concepts</title><style>${contextual ? '' : css}</style></head><body><div id="root"></div><script>${script.replaceAll('</script', '<\\/script')}</script></body></html>`;
await mkdir(resolve(root, '.test-data/previews'), { recursive: true });
await writeFile(output, html);
console.log(`Self-contained preview: ${output}`);
console.log(`HTML size: ${Buffer.byteLength(html)} bytes`);

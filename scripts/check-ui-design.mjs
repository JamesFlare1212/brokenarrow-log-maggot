import { readdir, readFile, access } from 'node:fs/promises';
import { resolve, relative, dirname, extname } from 'node:path';
import { parsers } from 'prettier/plugins/typescript';

const root = resolve('.');
async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? filesIn(path) : [path];
    }),
  );
  return nested.flat().sort();
}
const sourceFiles = await filesIn(resolve('apps/web/src'));
const jsxFiles = sourceFiles.filter((path) => extname(path) === '.tsx');
const cardUses = [];
const toggleUses = [];
const featureOverrides = [];
const retiredVariants = [];
for (const path of jsxFiles) {
  const source = await readFile(path, 'utf8');
  const ast = parsers.typescript.parse(source, { filepath: path });
  const aliases = new Set();
  for (const statement of ast.body) {
    if (statement.type !== 'ImportDeclaration') continue;
    if (!/(?:components\/ui|ui\/card)$/.test(statement.source.value)) continue;
    for (const entry of statement.specifiers) {
      if (entry.type === 'ImportSpecifier' && entry.imported.name === 'Card')
        aliases.add(entry.local.name);
    }
  }
  const visited = new WeakSet();
  const visit = (node) => {
    if (!node || typeof node !== 'object' || visited.has(node)) return;
    visited.add(node);
    if (node.type === 'JSXOpeningElement') {
      const name = node.name.name;
      const attributes = node.attributes.filter((entry) => entry.type === 'JSXAttribute');
      const textAttribute = (name) => {
        const attribute = attributes.find((entry) => entry.name.name === name);
        return typeof attribute?.value?.value === 'string' ? attribute.value.value : null;
      };
      const entry = {
        file: relative(root, path).replaceAll('\\', '/'),
        line: node.loc?.start.line ?? source.slice(0, node.range?.[0] ?? 0).split('\n').length,
        component: name,
        classes: textAttribute('className') ?? '',
      };
      if (aliases.has(name)) {
        cardUses.push(entry);
        if (
          /(?:^|\s)(?:bg-|shadow-|backdrop-|rounded-|border-(?!0\b|transparent\b))/.test(
            entry.classes,
          )
        )
          featureOverrides.push(entry);
      }
      if (name === 'ToggleGroup') {
        const variant = textAttribute('variant');
        toggleUses.push({ ...entry, variant });
        if (variant === 'appearance') retiredVariants.push(entry);
      }
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  };
  visit(ast);
}
const paths = new Set(cardUses.flatMap((entry) => entry.classes.split(/\s+/)).filter(Boolean));
const cssOverrides = [];
for (const path of sourceFiles.filter((entry) => extname(entry) === '.css')) {
  const css = await readFile(path, 'utf8');
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map((selector) => selector.trim());
    if (!selectors.some((selector) => /^\.[\w-]+$/.test(selector) && paths.has(selector.slice(1))))
      continue;
    const declarations = match[2].split(';').map((value) => value.trim());
    const surface = declarations.filter((declaration) =>
      /^(?:background(?:-color)?|border(?:-color|-radius)?|box-shadow|backdrop-filter)\s*:/.test(
        declaration,
      ),
    );
    if (surface.length)
      cssOverrides.push({ file: relative(root, path), selectors, declarations: surface });
  }
}
const markdownFiles = [
  resolve('README.md'),
  resolve('AGENTS.md'),
  ...(await filesIn(resolve('docs'))).filter((path) => extname(path) === '.md'),
  ...(await filesIn(resolve('design-system'))).filter((path) => extname(path) === '.md'),
];
const brokenLinks = [];
let checkedLinks = 0;
for (const path of markdownFiles) {
  const markdown = await readFile(path, 'utf8');
  for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^)\n]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '').split('#')[0];
    if (!target || /^[\w-]+:/.test(target)) continue;
    checkedLinks++;
    try {
      await access(resolve(dirname(path), decodeURIComponent(target)));
    } catch {
      brokenLinks.push({ file: relative(root, path), target });
    }
  }
}
const result = {
  sourceFiles: sourceFiles.length,
  reactModules: jsxFiles.length,
  primitiveModules: jsxFiles.filter((path) =>
    relative(root, path).replaceAll('\\', '/').includes('/components/ui/'),
  ).length,
  featureModules: jsxFiles.filter((path) =>
    relative(root, path).replaceAll('\\', '/').includes('/features/'),
  ).length,
  cssModules: sourceFiles.filter((path) => extname(path) === '.css').length,
  cardSites: cardUses.length,
  cardConsumers: [...new Set(cardUses.map((entry) => entry.file))],
  cardChoiceSites: toggleUses.filter((entry) => entry.variant === 'card'),
  featureOverrides,
  cssOverrides,
  retiredVariants,
  documentationFiles: markdownFiles.length,
  checkedLinks,
  brokenLinks,
};
if (
  featureOverrides.length ||
  cssOverrides.length ||
  retiredVariants.length ||
  brokenLinks.length
) {
  console.error(
    JSON.stringify({ featureOverrides, cssOverrides, retiredVariants, brokenLinks }, null, 2),
  );
  process.exitCode = 1;
} else if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(
    `UI design checks passed: ${result.reactModules} React modules, ${result.cardSites} Card sites, ${result.cardChoiceSites.length} card-choice groups, and ${checkedLinks} local documentation links.`,
  );
}

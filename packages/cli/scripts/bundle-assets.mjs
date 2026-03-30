import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const cliRoot = path.resolve(here, '..');
const repoRoot = path.resolve(cliRoot, '..', '..');

const copies = [
  {
    from: path.join(repoRoot, 'packages/server/dist'),
    to: path.join(cliRoot, 'vendor/server-dist'),
    label: 'server dist',
  },
  {
    from: path.join(repoRoot, 'packages/web/dist'),
    to: path.join(cliRoot, 'vendor/web-dist'),
    label: 'web dist',
  },
];

for (const copy of copies) {
  if (!fs.existsSync(copy.from)) {
    throw new Error(`Missing ${copy.label} at ${copy.from}. Run the full repo build first.`);
  }

  fs.rmSync(copy.to, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(copy.to), { recursive: true });
  fs.cpSync(copy.from, copy.to, { recursive: true });
  console.log(`Bundled ${copy.label} -> ${copy.to}`);
}

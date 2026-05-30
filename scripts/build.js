import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const dist = path.join(root, 'dist');
const esbuildBinary = path.join(root, 'node_modules', '@esbuild', 'darwin-arm64', 'bin', 'esbuild');
const fallbackBinary = path.join(root, 'node_modules', '.bin', 'esbuild');
const command = fs.existsSync(esbuildBinary) ? esbuildBinary : fallbackBinary;

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });

const result = spawnSync(
  command,
  [
    './src/main.jsx',
    '--bundle',
    '--outfile=dist/assets/app.js',
    '--format=esm',
    '--loader:.jsx=jsx',
    '--jsx=automatic',
    '--minify'
  ],
  { stdio: 'inherit' }
);

if (result.status !== 0) {
  process.exit(result.status || 1);
}

function fingerprint(filePath) {
  const contents = fs.readFileSync(filePath);
  return createHash('sha256').update(contents).digest('hex').slice(0, 10);
}

const jsHash = fingerprint(path.join(dist, 'assets', 'app.js'));
const cssHash = fingerprint(path.join(dist, 'assets', 'app.css'));
const jsName = `app.${jsHash}.js`;
const cssName = `app.${cssHash}.css`;

fs.renameSync(path.join(dist, 'assets', 'app.js'), path.join(dist, 'assets', jsName));
fs.renameSync(path.join(dist, 'assets', 'app.css'), path.join(dist, 'assets', cssName));

const html = fs
  .readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace('/src/main.jsx', `/assets/${jsName}`)
  .replace('</head>', `    <link rel="stylesheet" href="/assets/${cssName}" />\n  </head>`);

fs.writeFileSync(path.join(dist, 'index.html'), html);

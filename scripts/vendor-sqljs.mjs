// Copies the sql.js browser build from node_modules into vendor/sql.js/.
// Chrome extensions can't load remote scripts, so the library ships inside the extension.
//
//   npm install && npm run vendor

import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'node_modules', 'sql.js');
const DEST = path.join(ROOT, 'vendor', 'sql.js');

const FILES = {
    'dist/sql-wasm-browser.js': 'sql-wasm-browser.js',
    'dist/sql-wasm-browser.wasm': 'sql-wasm-browser.wasm',
    'LICENSE': 'LICENSE'
};

await mkdir(DEST, { recursive: true });
for (const [from, to] of Object.entries(FILES)) {
    await copyFile(path.join(SRC, from), path.join(DEST, to));
    console.log(`vendor/sql.js/${to}`);
}

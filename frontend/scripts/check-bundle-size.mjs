import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_ENTRY_BYTES = 500 * 1024;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const distDirectory = join(scriptDirectory, '..', 'dist');
const indexHtml = await readFile(join(distDirectory, 'index.html'), 'utf8');
const entryMatch = indexHtml.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/u);

if (!entryMatch) {
  throw new Error('Unable to find the production module entry in dist/index.html.');
}

const entryPath = join(distDirectory, entryMatch[1].replace(/^\//u, ''));
const entryBytes = (await stat(entryPath)).size;

if (entryBytes > MAX_ENTRY_BYTES) {
  throw new Error(
    `Initial JavaScript entry is ${(entryBytes / 1024).toFixed(1)} KiB; ` +
      `the architecture budget is ${MAX_ENTRY_BYTES / 1024} KiB. ` +
      'Move route-only code behind dynamic imports.',
  );
}

console.log(`Initial JavaScript entry passed: ${(entryBytes / 1024).toFixed(1)} KiB.`);

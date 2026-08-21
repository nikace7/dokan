/**
 * Post-build version stamp: writes dist/version.json so the running SPA can
 * detect that a newer build was deployed and prompt a reload (an open tab
 * never reloads itself). nginx serves root files with no-store, so the poll
 * always sees the latest. Timestamp millis are unique enough per deploy.
 */
import { writeFileSync } from 'node:fs';

const out = new URL('../dist/version.json', import.meta.url);
writeFileSync(out, JSON.stringify({ version: String(Date.now()) }) + '\n');
console.log(`stamped dist/version.json (${Date.now()})`);

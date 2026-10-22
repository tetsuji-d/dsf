import {readFileSync} from 'node:fs';

// Keep the pinned baseline and the accepted major in one place.
const minimum = readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim();
const expected = minimum.split('.').map(Number);
const actual = process.versions.node.split('.').map(Number);
const supported = /^\d+\.\d+\.\d+$/.test(process.versions.node)
    && actual[0] === expected[0]
    && (actual[1] > expected[1] || (actual[1] === expected[1] && actual[2] >= expected[2]));
if (!supported) {
    console.error(`DSF requires Node.js >=${minimum} <${expected[0] + 1}. Current: ${process.version} (${process.execPath}). Update Node.js and reopen your terminal.`);
    process.exit(1);
}
console.log(`DSF Node.js check OK: ${process.version} (${process.execPath})`);

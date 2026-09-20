#!/usr/bin/env node
// Offline only. Input can contain manuscript data; stdout contains only a bounded report.
import { readFile, open, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inspectMigrationBundle } from '../server/private-authoring/maintenance.js';
import { createPrivateAuthoringRetentionReport } from '../server/private-authoring/retention.js';
const args = process.argv.slice(2);
try {
    if (args.length < 2 || args.length > 3 || !['migration', 'retention'].includes(args[0])) throw Error('USAGE: node scripts/inspect-private-authoring.js migration|retention input.json [new-report.json]');
    if ((await stat(args[1])).size > 32 * 1024 * 1024) throw Error('INPUT_TOO_LARGE');
    const buffer = await readFile(args[1]); if (buffer.length > 32 * 1024 * 1024) throw Error('INPUT_TOO_LARGE');
    const input = JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''));
    const report = args[0] === 'migration' ? await inspectMigrationBundle(input) : createPrivateAuthoringRetentionReport(input);
    const output = JSON.stringify(report, null, 2) + '\n';
    if (args[2]) {
        if (resolve(args[1]) === resolve(args[2])) throw Error('OUTPUT_MUST_DIFFER_FROM_INPUT');
        const file = await open(args[2], 'wx'); try { await file.writeFile(output); } finally { await file.close(); }
        console.log('Read-only report written. No cloud connections or data changes.');
    } else process.stdout.write(output);
} catch (error) { console.error(error.code || (/^USAGE:/.test(error.message) ? error.message : 'INSPECTION_FAILED')); process.exitCode = 1; }

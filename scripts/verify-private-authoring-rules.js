import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
// Uses an already installed emulator and JDK. Never downloads or contacts a cloud project.
const cache = join(homedir(), '.cache', 'firebase', 'emulators');
const jars = existsSync(cache) ? readdirSync(cache).filter(name => /^cloud-firestore-emulator-v[\d.]+\.jar$/.test(name)).sort() : [];
const jar = process.env.FIRESTORE_EMULATOR_JAR || (jars.length ? join(cache, jars.at(-1)) : '');
if (!existsSync(jar)) throw Error('Set FIRESTORE_EMULATOR_JAR to an installed Firestore emulator JAR.');
const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
const port = 8199, address = `127.0.0.1:${port}`, project = 'demo-dsf-authoring-unit-c';
let log = '', exited = false;
const emulator = spawn(java, ['-Duser.language=en', '-Duser.country=US', '-jar', jar, '--host', '127.0.0.1', '--port', String(port),
    '--project_id', project, '--rules', resolve('firestore.rules'), '--single_project_mode', 'true'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
emulator.on('error', error => { log += error.message; exited = true; });
emulator.on('exit', () => { exited = true; });
for (const stream of [emulator.stdout, emulator.stderr]) stream.on('data', bytes => { log = (log + bytes).slice(-24_000); });
try {
    let ready = false;
    for (let attempt = 0; attempt < 80 && !exited; attempt++) {
        if (log.includes('Dev App Server is now running')) { ready = true; break; }
        await delay(250);
    }
    if (!ready) throw Error(`Local emulator did not start. ${log.slice(-2000)}`);
    const test = spawn(process.execPath, ['scripts/verify-private-authoring-rules-emulator.js'], { windowsHide: true, stdio: 'inherit',
        env: { ...process.env, FIRESTORE_EMULATOR_HOST: address, GCLOUD_PROJECT: project } });
    const timeout = setTimeout(() => test.kill(), 120_000);
    try {
        const status = await new Promise((resolve, reject) => { test.on('error', reject); test.on('exit', resolve); });
        if (status !== 0) throw Error(`Rules verifier failed (${status}). ${log.slice(-2000)}`);
    } finally { clearTimeout(timeout); }
} finally { if (!exited) emulator.kill(); }

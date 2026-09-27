import { spawn } from 'node:child_process';
import { existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const rules = resolve(process.argv[2] || 'firestore.rules');
const cache = join(homedir(), '.cache/firebase/emulators');
const jars = existsSync(cache) ? readdirSync(cache).filter(n => /^cloud-firestore-emulator-v[\d.]+\.jar$/.test(n)).sort() : [];
const jar = process.env.FIRESTORE_EMULATOR_JAR || (jars.length ? join(cache, jars.at(-1)) : '');
if (!existsSync(jar) || !existsSync(rules)) throw Error('Installed emulator and rules file required');
const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
const port = 8209, project = 'demo-dsf-review-boundaries';
let log = '', exited = false;
const emulator = spawn(java, ['-Duser.language=en', '-Duser.country=US', '-jar', jar, '--host', '127.0.0.1', '--port', String(port),
    '--project_id', project, '--rules', rules, '--single_project_mode', 'true'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
emulator.on('error', e => { log += e.message; exited = true; });
emulator.on('exit', () => { exited = true; });
for (const stream of [emulator.stdout, emulator.stderr]) stream.on('data', bytes => { log = (log + bytes).slice(-100000); });
try {
    let ready = false;
    for (let i = 0; i < 160 && !exited; i++) {
        if (log.includes('Dev App Server is now running')) { ready = true; break; }
        await delay(250);
    }
    if (!ready) throw Error(`Emulator did not start: ${log.slice(-3000)}`);
    const test = spawn(process.execPath, ['scripts/verify-review-rules-emulator.mjs'], { windowsHide: true, stdio: 'inherit',
        env: { ...process.env, FIRESTORE_EMULATOR_HOST: `127.0.0.1:${port}`, GCLOUD_PROJECT: project } });
    const timeout = setTimeout(() => test.kill(), 120000);
    try {
        const code = await new Promise((resolve, reject) => { test.on('error', reject); test.on('exit', resolve); });
        if (code !== 0) throw Error(`Review verifier failed (${code}); see outputs/review-boundaries/emulator.log`);
    } finally { clearTimeout(timeout); }
} finally {
    if (!exited) emulator.kill();
    mkdirSync('outputs/review-boundaries', { recursive: true });
    writeFileSync('outputs/review-boundaries/emulator.log', log);
}

import { spawnSync } from 'node:child_process';

const CHECK_FILES = [
  'js/app.js',
  'js/firebase.js',
  'js/export.js',
  'js/press.js',
  'js/sections.js',
  'js/viewer.js',
  'js/pages.js',
  'js/blocks.js',
  'js/projects.js',
  'js/works.js',
];

const skipGitCheck = process.argv.includes('--skip-git-check');
const checkOnly = process.argv.includes('--check-only');

function bin(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function run(command, args, options = {}) {
  const label = [command, ...args].join(' ');
  console.log(`\n> ${label}`);
  const useCmdShim = process.platform === 'win32' && /\.cmd$/i.test(command);
  const spawnCommand = useCmdShim ? (process.env.ComSpec || 'cmd.exe') : command;
  const spawnArgs = useCmdShim ? ['/d', '/s', '/c', command, ...args] : args;
  const result = spawnSync(spawnCommand, spawnArgs, {
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = result.stderr ? `\n${result.stderr.trim()}` : '';
    throw new Error(`Command failed: ${label}${stderr}`);
  }
  return result.stdout || '';
}

function assertGitReady() {
  if (skipGitCheck) {
    console.log('Git safety check skipped by --skip-git-check.');
    return;
  }

  const branch = run(bin('git'), ['branch', '--show-current'], { capture: true }).trim();
  if (branch !== 'main') {
    throw new Error(`Production deploy must run from main. Current branch: ${branch || '(unknown)'}`);
  }

  const status = run(bin('git'), ['status', '--porcelain'], { capture: true }).trim();
  if (status) {
    throw new Error(`Working tree is not clean. Commit or stash changes before production deploy.\n${status}`);
  }

  const branchStatus = run(bin('git'), ['status', '--short', '--branch'], { capture: true }).trim();
  if (/\[(ahead|behind|diverged)/.test(branchStatus)) {
    throw new Error(`main is not aligned with origin/main. Push or pull first.\n${branchStatus}`);
  }

  console.log(`Git safety check OK: ${branchStatus}`);
}

function checkSyntax() {
  for (const file of CHECK_FILES) {
    run(process.execPath, ['--check', file]);
  }
}

function main() {
  console.log('DSF safe production deploy');
  assertGitReady();
  checkSyntax();
  run(bin('npm'), ['run', 'build']);
  if (checkOnly) {
    console.log('\nProduction deploy check complete. No deployment was performed.');
    return;
  }
  run(bin('npx'), ['firebase', 'deploy', '--project', 'prod', '--only', 'firestore:rules']);
  run(bin('npx'), ['wrangler', 'pages', 'deploy', 'dist', '--project-name', 'dsf-studio']);
  console.log('\nProduction deploy complete.');
}

try {
  main();
} catch (error) {
  console.error(`\nProduction deploy aborted: ${error.message}`);
  process.exit(1);
}

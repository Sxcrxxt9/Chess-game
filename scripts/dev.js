import { spawn, spawnSync } from 'node:child_process';

const env = {
  ...process.env,
  NODE_ENV: 'production'
};

const build = spawnSync('node', ['scripts/build.js'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status || 1);

const server = spawn('node', ['server/index.js'], { env, stdio: 'inherit' });

function shutdown() {
  if (!server.killed) server.kill('SIGINT');
}

process.on('SIGINT', () => {
  shutdown();
  setTimeout(() => process.exit(0), 200);
});
process.on('SIGTERM', shutdown);

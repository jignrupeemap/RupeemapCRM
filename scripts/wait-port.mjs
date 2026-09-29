// Waits until something is listening on a local port. Used by START-RUPEEMAP.bat.
// Usage: node scripts/wait-port.mjs <port> [seconds] [label]
import net from 'node:net';

const [port, seconds = '90', label = `port ${process.argv[2]}`] = process.argv.slice(2);
const deadline = Date.now() + Number(seconds) * 1000;

function tryOnce() {
  return new Promise((resolve) => {
    const s = net.connect({ port: Number(port), host: '127.0.0.1' });
    s.once('connect', () => (s.end(), resolve(true)));
    s.once('error', () => resolve(false));
  });
}

process.stdout.write(`Waiting for ${label}`);
while (Date.now() < deadline) {
  if (await tryOnce()) {
    console.log(' ready.');
    process.exit(0);
  }
  process.stdout.write('.');
  await new Promise((r) => setTimeout(r, 2000));
}
console.log(` did not start within ${seconds} seconds. Check its window for errors.`);
process.exit(1);

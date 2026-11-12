import { initDb, persist } from './db.js';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';

await initDb();
const app = createApp();

const server = app.listen(PORT, HOST, () => {
  console.log(`[pms] listening on http://${HOST}:${PORT}`);
});

function shutdown(signal) {
  console.log(`[pms] ${signal} received, shutting down`);
  server.close(() => {
    persist();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('exit', () => persist());

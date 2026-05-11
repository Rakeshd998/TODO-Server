import 'dotenv/config';
import cluster from 'cluster';
import os from 'os';
import app from './app';
import connectDB from './config/db';

const PORT = process.env.PORT || 5000;
const NUM_CPUS = os.cpus().length;
const isDev = process.env.NODE_ENV !== 'production';

// ─── Primary Process ──────────────────────────────────────────────────────────
if (cluster.isPrimary) {
  console.log(`\n🧠 Primary process  [PID: ${process.pid}]`);
  console.log(`⚙️  Spawning ${isDev ? 1 : NUM_CPUS} worker(s) across ${NUM_CPUS} CPU core(s)\n`);

  // In development use 1 worker to avoid duplicate logs; production uses all cores
  const workerCount = isDev ? 1 : NUM_CPUS;
  for (let i = 0; i < workerCount; i++) cluster.fork();

  // Restart a worker if it dies unexpectedly — with exponential backoff
  const restartAttempts = new Map<number, number>();
  const MAX_RESTARTS = 5;
  const BASE_DELAY_MS = 1000;

  cluster.on('exit', (worker, code, signal) => {
    const reason = signal ?? `exit code ${code}`;
    const attempts = (restartAttempts.get(worker.id) ?? 0) + 1;

    if (attempts > MAX_RESTARTS) {
      console.error(
        `💀 Worker [PID: ${worker.process.pid}] has crashed ${MAX_RESTARTS} times. Not restarting. Fix the issue and restart the server.`
      );
      if (Object.keys(cluster.workers ?? {}).length === 0) process.exit(1);
      return;
    }

    const delay = BASE_DELAY_MS * 2 ** (attempts - 1); // 1s, 2s, 4s, 8s, 16s
    console.warn(
      `⚠️  Worker [PID: ${worker.process.pid}] died (${reason}). Restart ${attempts}/${MAX_RESTARTS} in ${delay}ms…`
    );

    setTimeout(() => {
      const newWorker = cluster.fork();
      restartAttempts.set(newWorker.id, attempts);
    }, delay);
  });

  cluster.on('online', (worker) => {
    console.log(`✅ Worker [PID: ${worker.process.pid}] is online`);
  });

  // Graceful shutdown: forward signal to all workers
  const shutdown = (signal: string) => {
    console.log(`\n🛑 Primary received ${signal}. Shutting down workers…`);
    for (const id in cluster.workers) {
      cluster.workers[id]?.kill(signal);
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

// ─── Worker Process ───────────────────────────────────────────────────────────
} else {
  const startWorker = async () => {
    try {
      await connectDB();

      const server = app.listen(PORT, () => {
        console.log(`🚀 Worker  [PID: ${process.pid}] listening on http://localhost:${PORT}`);
      });

      // Graceful shutdown: stop accepting new connections, finish existing ones
      const gracefulShutdown = (signal: string) => {
        console.log(`🔌 Worker  [PID: ${process.pid}] received ${signal}. Closing server…`);
        server.close(() => {
          console.log(`👋 Worker  [PID: ${process.pid}] exited cleanly.`);
          process.exit(0);
        });

        // Force-kill if still alive after 10 s
        setTimeout(() => {
          console.error(`💀 Worker  [PID: ${process.pid}] force-killed after timeout.`);
          process.exit(1);
        }, 10_000).unref();
      };

      process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
      process.on('SIGINT', () => gracefulShutdown('SIGINT'));

      // Unhandled rejections / exceptions — log and let primary restart the worker
      process.on('unhandledRejection', (reason) => {
        console.error(`🔥 Worker  [PID: ${process.pid}] unhandledRejection:`, reason);
        process.exit(1);
      });

      process.on('uncaughtException', (err) => {
        console.error(`💥 Worker  [PID: ${process.pid}] uncaughtException:`, err);
        process.exit(1);
      });

    } catch (err) {
      console.error(`❌ Worker  [PID: ${process.pid}] failed to start:`, err);
      process.exit(1);
    }
  };

  startWorker();
}

import 'dotenv/config';
import http from 'http';
import cluster from 'cluster';
import os from 'os';
import app from './app';
import connectDB from './config/db';
import { connectRedis } from './config/redis';
import { connectProducer, enableKafka, disconnectKafka } from './config/kafka';
import { initSocketServer } from './socket/index';
import { startChatConsumer } from './socket/kafka.consumer';

const PORT = process.env.PORT || 5000;
const NUM_CPUS = os.cpus().length;
// Worker count comes from WEB_CONCURRENCY (default 1). os.cpus() reports the host's
// cores, not the container's share — on small instances (e.g. Render free: 0.1 CPU,
// 512 MB) one worker per core means slow cold starts and out-of-memory restarts.
// More than 1 worker also needs Redis + sticky sessions for Socket.IO.
const WORKER_COUNT = Math.max(1, Math.min(NUM_CPUS, parseInt(process.env.WEB_CONCURRENCY ?? '1') || 1));

// ─── Primary Process ──────────────────────────────────────────────────────────
if (cluster.isPrimary) {
  console.log(`\n🧠 Primary process  [PID: ${process.pid}]`);
  console.log(`⚙️  Spawning ${WORKER_COUNT} worker(s) across ${NUM_CPUS} CPU core(s)\n`);

  for (let i = 0; i < WORKER_COUNT; i++) cluster.fork();

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
      // Connect to MongoDB
      await connectDB();

      // Connect to Redis (Socket.IO adapter + online presence) — optional
      const redisReady = await connectRedis();
      if (!redisReady && WORKER_COUNT > 1) {
        console.warn('⚠️  Running multiple workers without Redis — chat between workers will not be delivered.');
      }

      // Create HTTP server from Express app
      const httpServer = http.createServer(app);

      // Initialize Socket.IO (Redis adapter attached when available)
      initSocketServer(httpServer);

      // Start listening before Kafka so the host sees the port open as early as possible
      httpServer.listen(PORT, () => {
        console.log(`🚀 Worker  [PID: ${process.pid}] listening on http://localhost:${PORT}`);
      });

      // Start Kafka (producer + consumer) — optional; until it's ready (or if it
      // never is) chat messages are delivered directly
      const kafkaReady = (await connectProducer()) && (await startChatConsumer());
      if (kafkaReady) enableKafka();
      else await disconnectKafka();

      // Graceful shutdown: stop accepting new connections, finish existing ones
      const gracefulShutdown = (signal: string) => {
        console.log(`🔌 Worker  [PID: ${process.pid}] received ${signal}. Closing server…`);
        httpServer.close(() => {
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

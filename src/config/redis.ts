import Redis from 'ioredis';

// Redis is optional: leave REDIS_URL unset to skip it entirely (e.g. on a single small instance)
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_ENABLED = !!process.env.REDIS_URL;

// Stop retrying after a few attempts so a missing Redis doesn't spam the logs forever
const retryStrategy = (times: number): number | null =>
  times > 10 ? null : Math.min(times * 200, 3000);

// Main client (commands)
export const redisClient = new Redis(REDIS_URL, {
  lazyConnect: true,
  retryStrategy,
  maxRetriesPerRequest: 3,
});

// Dedicated pub/sub clients required by @socket.io/redis-adapter
export const redisPub = new Redis(REDIS_URL, { lazyConnect: true, retryStrategy });
export const redisSub = new Redis(REDIS_URL, { lazyConnect: true, retryStrategy });

// Prevent "Unhandled error event" noise — connection state is checked via isRedisReady()
[redisClient, redisPub, redisSub].forEach((c) => c.on('error', () => {}));

let redisAvailable = false;

export const isRedisReady = (): boolean => redisAvailable && redisClient.status === 'ready';

// Non-fatal: returns false if Redis is unreachable so the API can still run
export const connectRedis = async (): Promise<boolean> => {
  if (!REDIS_ENABLED) {
    console.log('ℹ️  REDIS_URL not set — using in-memory presence (single worker only)');
    return false;
  }
  try {
    await Promise.all([redisClient.connect(), redisPub.connect(), redisSub.connect()]);
    redisAvailable = true;
    console.log('✅ Redis connected');
  } catch (err) {
    redisAvailable = false;
    [redisClient, redisPub, redisSub].forEach((c) => c.disconnect());
    console.warn('⚠️  Redis unavailable — using in-memory presence (single worker only):', (err as Error).message);
  }
  return redisAvailable;
};

// ─── Online presence ──────────────────────────────────────────────────────────
// Each user has a connection counter, so closing one of several tabs doesn't
// mark them offline. The set of online user IDs avoids an O(N) KEYS scan.
const ONLINE_SET = 'presence:online';
const countKey = (userId: string) => `presence:count:${userId}`;

const memoryCounts = new Map<string, number>();

export const setOnline = async (userId: string): Promise<void> => {
  if (!isRedisReady()) {
    memoryCounts.set(userId, (memoryCounts.get(userId) ?? 0) + 1);
    return;
  }
  await redisClient.multi().incr(countKey(userId)).sadd(ONLINE_SET, userId).exec();
};

export const setOffline = async (userId: string): Promise<void> => {
  if (!isRedisReady()) {
    const next = (memoryCounts.get(userId) ?? 1) - 1;
    if (next > 0) memoryCounts.set(userId, next);
    else memoryCounts.delete(userId);
    return;
  }
  const remaining = await redisClient.decr(countKey(userId));
  if (remaining <= 0) {
    await redisClient.multi().del(countKey(userId)).srem(ONLINE_SET, userId).exec();
  }
};

export const getOnlineUserIds = async (): Promise<string[]> => {
  if (!isRedisReady()) return [...memoryCounts.keys()];
  return redisClient.smembers(ONLINE_SET);
};

import { Server as HttpServer } from 'http';
import mongoose from 'mongoose';
import { Server as SocketServer, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { redisPub, redisSub, isRedisReady, setOnline, setOffline, getOnlineUserIds } from '../config/redis';
import { verifyAccessToken } from '../utils/jwt';
import { produceMessage, isKafkaReady } from '../config/kafka';
import { persistAndDeliver, type ChatMessagePayload } from './delivery';

let io: SocketServer;

const MAX_MESSAGE_LENGTH = 2000;

interface AuthSocket extends Socket {
  userId?: string;
}

interface SendMessageData {
  to?: unknown;
  content?: unknown;
  clientId?: unknown;
}

const broadcastOnlineUsers = async () => {
  try {
    io.emit('online-users', await getOnlineUserIds());
  } catch (err) {
    console.error('Presence lookup error:', err);
  }
};

export const initSocketServer = (httpServer: HttpServer): SocketServer => {
  const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim());

  io = new SocketServer(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // ─── Attach Redis adapter (enables multi-worker pub/sub) ──────────────────
  // Without Redis the default in-memory adapter is used (single worker only).
  if (isRedisReady()) {
    io.adapter(createAdapter(redisPub, redisSub));
  }

  // ─── JWT authentication middleware ────────────────────────────────────────
  io.use((socket: AuthSocket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('Authentication token required'));

    try {
      const payload = verifyAccessToken(token);
      if (payload.type !== 'access') return next(new Error('Invalid token type'));
      socket.userId = payload.userId;
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  // ─── Connection handler ───────────────────────────────────────────────────
  io.on('connection', async (socket: AuthSocket) => {
    const userId = socket.userId!;
    console.log(`🔌 Socket connected  [userId: ${userId}  socketId: ${socket.id}]`);

    // Join personal room first so no messages are missed while presence updates
    socket.join(`user:${userId}`);

    try {
      await setOnline(userId);
    } catch (err) {
      console.error('Presence update error:', err);
    }
    await broadcastOnlineUsers();

    // ─── send-message event ─────────────────────────────────────────────────
    socket.on('send-message', async (data: SendMessageData) => {
      const to = typeof data?.to === 'string' ? data.to : '';
      const content = typeof data?.content === 'string' ? data.content.trim() : '';
      const clientId = typeof data?.clientId === 'string' ? data.clientId : undefined;

      const fail = (message: string) => socket.emit('message-error', { clientId, to, message });

      if (!mongoose.Types.ObjectId.isValid(to) || to === userId) return fail('Invalid recipient');
      if (!content) return fail('Message cannot be empty');
      if (content.length > MAX_MESSAGE_LENGTH) {
        return fail(`Message must be at most ${MAX_MESSAGE_LENGTH} characters`);
      }

      const payload: ChatMessagePayload = {
        senderId: userId,
        receiverId: to,
        content,
        timestamp: new Date().toISOString(),
        clientId,
      };

      try {
        if (isKafkaReady()) {
          // Consumer will persist + emit
          await produceMessage(payload);
        } else {
          await persistAndDeliver(payload);
        }
      } catch (err) {
        console.error('Message send error:', err);
        fail('Failed to send message. Please try again.');
      }
    });

    // ─── typing indicators ───────────────────────────────────────────────────
    socket.on('typing', (data: { to?: unknown; isTyping?: unknown }) => {
      if (typeof data?.to !== 'string' || !mongoose.Types.ObjectId.isValid(data.to)) return;
      io.to(`user:${data.to}`).emit('user-typing', {
        from: userId,
        isTyping: data.isTyping === true,
      });
    });

    // ─── disconnect ──────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      try {
        await setOffline(userId);
      } catch (err) {
        console.error('Presence update error:', err);
      }
      await broadcastOnlineUsers();
      console.log(`❌ Socket disconnected [userId: ${userId}  socketId: ${socket.id}]`);
    });
  });

  console.log('🚀 Socket.IO server initialized');
  return io;
};

// Export io instance for use in message delivery and REST controllers
export const getIO = (): SocketServer => {
  if (!io) throw new Error('Socket.IO not initialized');
  return io;
};

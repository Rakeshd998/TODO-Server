import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { User } from '../models/User';
import { Message } from '../models/Message';
import asyncHandler from '../utils/asyncHandler';
import ApiError from '../utils/ApiError';
import { getIO } from '../socket/index';

// ─── GET /api/chat/users ──────────────────────────────────────────────────────
// List all registered users (excluding the requesting user) for starting a chat
export const getUsers = asyncHandler(async (req: Request, res: Response) => {
  const currentUserId = req.user!._id;

  const users = await User.find(
    { _id: { $ne: currentUserId } },
    { _id: 1, name: 1, email: 1, createdAt: 1 }
  ).sort({ name: 1 });

  res.json({ statusCode: 200, message: 'Users fetched', data: users });
});

// ─── GET /api/chat/history/:userId ───────────────────────────────────────────
// Fetch paginated message history between current user and another user
export const getHistory = asyncHandler(async (req: Request, res: Response) => {
  const currentUserId = req.user!._id;
  const { userId: otherUserId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(otherUserId)) {
    throw new ApiError(400, 'Invalid user ID');
  }

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, parseInt(req.query.limit as string) || 30);
  const skip = (page - 1) * limit;

  const messages = await Message.find({
    $or: [
      { senderId: currentUserId, receiverId: otherUserId },
      { senderId: otherUserId, receiverId: currentUserId },
    ],
  })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  // Return in chronological order
  res.json({
    statusCode: 200,
    message: 'History fetched',
    data: messages.reverse(),
    pagination: { page, limit },
  });
});

// ─── PATCH /api/chat/read/:userId ─────────────────────────────────────────────
// Mark all messages FROM a user as read
export const markRead = asyncHandler(async (req: Request, res: Response) => {
  const currentUserId = req.user!._id;
  const { userId: senderId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(senderId)) {
    throw new ApiError(400, 'Invalid user ID');
  }

  const { modifiedCount } = await Message.updateMany(
    { senderId, receiverId: currentUserId, read: false },
    { $set: { read: true } }
  );

  // Live read receipt — tell the sender their messages were seen
  if (modifiedCount > 0) {
    try {
      getIO().to(`user:${senderId}`).emit('messages-read', { by: currentUserId.toString() });
    } catch (err) {
      console.error('Read receipt emit error:', err);
    }
  }

  res.json({ statusCode: 200, message: 'Messages marked as read', data: null });
});

// ─── GET /api/chat/unread ─────────────────────────────────────────────────────
// Get unread counts grouped by sender
export const getUnreadCounts = asyncHandler(async (req: Request, res: Response) => {
  const currentUserId = req.user!._id;

  const counts = await Message.aggregate([
    { $match: { receiverId: new mongoose.Types.ObjectId(currentUserId.toString()), read: false } },
    { $group: { _id: '$senderId', count: { $sum: 1 } } },
  ]);

  const result: Record<string, number> = {};
  counts.forEach((c) => {
    result[c._id.toString()] = c.count;
  });

  res.json({ statusCode: 200, message: 'Unread counts fetched', data: result });
});

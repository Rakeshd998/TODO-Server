import mongoose from 'mongoose';
import { Message } from '../models/Message';
import { getIO } from './index';

export interface ChatMessagePayload {
  senderId: string;
  receiverId: string;
  content: string;
  timestamp: string;
  clientId?: string; // client-generated id of the optimistic message, echoed back to the sender
}

// Persist a message to MongoDB and deliver it to both participants' rooms.
// Used by the Kafka consumer, and directly when Kafka is unavailable.
export const persistAndDeliver = async (payload: ChatMessagePayload): Promise<void> => {
  const { senderId, receiverId, content, timestamp, clientId } = payload;
  const io = getIO();

  let savedMessage;
  try {
    savedMessage = await Message.create({
      senderId: new mongoose.Types.ObjectId(senderId),
      receiverId: new mongoose.Types.ObjectId(receiverId),
      content,
      createdAt: new Date(timestamp),
    });
  } catch (err) {
    console.error('Failed to persist message to MongoDB:', err);
    io.to(`user:${senderId}`).emit('message-error', {
      clientId,
      to: receiverId,
      message: 'Failed to send message. Please try again.',
    });
    return;
  }

  const messagePayload = {
    _id: savedMessage._id.toString(),
    senderId,
    receiverId,
    content,
    read: false,
    createdAt: savedMessage.createdAt.toISOString(),
    updatedAt: savedMessage.updatedAt.toISOString(),
  };

  // Deliver to recipient's personal room
  io.to(`user:${receiverId}`).emit('new-message', messagePayload);
  // Confirm to sender (all their tabs) — clientId lets the sending tab replace its optimistic copy
  io.to(`user:${senderId}`).emit('message-confirmed', { ...messagePayload, clientId });
};

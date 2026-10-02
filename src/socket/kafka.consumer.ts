import { createChatConsumer } from '../config/kafka';
import { persistAndDeliver, type ChatMessagePayload } from './delivery';

// Returns false if the consumer couldn't start, so the caller can fall back to direct delivery
export const startChatConsumer = async (): Promise<boolean> => {
  try {
    const consumer = await createChatConsumer();

    await consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) return;

        let payload: ChatMessagePayload;
        try {
          payload = JSON.parse(message.value.toString()) as ChatMessagePayload;
        } catch {
          console.error('Invalid Kafka message format');
          return;
        }

        try {
          await persistAndDeliver(payload);
        } catch (err) {
          console.error('Message delivery error:', err);
        }
      },
    });

    console.log('🔄 Kafka consumer running — listening for chat messages');
    return true;
  } catch (err) {
    console.error('❌ Failed to start Kafka chat consumer:', (err as Error).message);
    return false;
  }
};

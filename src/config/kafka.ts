import { Kafka, Producer, Consumer, logLevel } from 'kafkajs';

// Kafka is optional: leave KAFKA_BROKERS unset to skip it and deliver chat messages directly
const KAFKA_ENABLED = !!process.env.KAFKA_BROKERS;
const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
export const CHAT_TOPIC = process.env.KAFKA_TOPIC || 'chat-messages';

const kafka = new Kafka({
  clientId: 'todo-chat-server',
  brokers,
  retry: { retries: 3, initialRetryTime: 300 },
  logLevel: logLevel.ERROR,
});

let producer: Producer | null = null;
let consumer: Consumer | null = null;
let kafkaAvailable = false;

export const isKafkaReady = (): boolean => kafkaAvailable;

// Called once both producer and consumer are running — only then route messages via Kafka
export const enableKafka = (): void => {
  kafkaAvailable = !!producer;
};

// ─── Producer ────────────────────────────────────────────────────────────────
// Non-fatal: returns false if Kafka is unreachable so chat falls back to direct delivery
export const connectProducer = async (): Promise<boolean> => {
  if (!KAFKA_ENABLED) {
    console.log('ℹ️  KAFKA_BROKERS not set — chat messages will be delivered directly');
    return false;
  }
  try {
    producer = kafka.producer();
    await producer.connect();
    console.log('✅ Kafka producer connected');
    return true;
  } catch (err) {
    producer = null;
    console.warn('⚠️  Kafka unavailable — chat messages will be delivered directly:', (err as Error).message);
    return false;
  }
};

export const produceMessage = async (payload: { senderId: string; receiverId: string }): Promise<void> => {
  if (!producer) throw new Error('Kafka producer not connected');
  // Key by conversation so messages between two users stay in order on one partition
  const key = [payload.senderId, payload.receiverId].sort().join(':');
  await producer.send({
    topic: CHAT_TOPIC,
    messages: [{ key, value: JSON.stringify(payload) }],
  });
};

// ─── Consumer factory ─────────────────────────────────────────────────────────
export const createChatConsumer = async (groupId = 'chat-group'): Promise<Consumer> => {
  if (!consumer) {
    consumer = kafka.consumer({ groupId });
    await consumer.connect();
    await consumer.subscribe({ topic: CHAT_TOPIC, fromBeginning: false });
    console.log('✅ Kafka consumer subscribed to', CHAT_TOPIC);
  }
  return consumer;
};

// ─── Graceful disconnect ──────────────────────────────────────────────────────
export const disconnectKafka = async (): Promise<void> => {
  kafkaAvailable = false;
  await producer?.disconnect().catch(() => {});
  await consumer?.disconnect().catch(() => {});
  producer = null;
  consumer = null;
};

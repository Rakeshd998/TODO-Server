import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import routes from './routes';
import { errorHandler, notFound } from './middleware/error.middleware';

const app = express();

// ─── CORS ─────────────────────────────────────────────────────────────────────
// app.use(
//   cors({
//     origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
//     credentials: true, // required to send/receive cookies cross-origin
//   })
// );

app.use(cors());

// ─── Body & Cookie Parsers ────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api', routes);

// ─── 404 & Error Handling ─────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

export default app;

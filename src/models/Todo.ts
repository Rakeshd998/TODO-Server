import mongoose, { Document, Schema } from 'mongoose';

export const TODO_PRIORITIES = ['low', 'medium', 'high'] as const;
export type TodoPriority = (typeof TODO_PRIORITIES)[number];

// Calendar date without time ("2026-10-03"). Stored as a string on purpose:
// "due today" / "overdue" depend on the *user's* local day, so the client sends
// its own today and we compare strings — no server-timezone surprises.
export const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Deleted todos stay restorable ("Undo") for at least this long before MongoDB's
// TTL monitor purges them (it runs every ~60s, so actual removal is 1–2 minutes).
export const TRASH_TTL_SECONDS = 60;

export interface ITodo {
  text: string;
  completed: boolean;
  dueDate: string | null;
  priority: TodoPriority;
  deletedAt: Date | null;
  userId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITodoDocument extends ITodo, Document {}

const todoSchema = new Schema<ITodoDocument>(
  {
    text: { type: String, required: true, trim: true, maxlength: 500 },
    completed: { type: Boolean, default: false },
    dueDate: { type: String, match: DATE_ONLY_REGEX, default: null },
    priority: { type: String, enum: TODO_PRIORITIES, default: 'medium' },
    deletedAt: { type: Date, default: null },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: true }
);

// Auto-purge trashed todos (documents with deletedAt = null are never expired)
todoSchema.index({ deletedAt: 1 }, { expireAfterSeconds: TRASH_TTL_SECONDS });

// Due-date filters ("overdue", "due today") per user
todoSchema.index({ userId: 1, deletedAt: 1, dueDate: 1 });

// Never send trash bookkeeping to clients
todoSchema.set('toJSON', {
  transform: (_doc, ret) => {
    const { deletedAt: _trash, ...visible } = ret;
    return visible;
  },
});

export const Todo = mongoose.model<ITodoDocument>('Todo', todoSchema);

import mongoose, { Document, Schema } from 'mongoose';

export interface ITodo {
  text: string;
  completed: boolean;
  userId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITodoDocument extends ITodo, Document {}

const todoSchema = new Schema<ITodoDocument>(
  {
    text: { type: String, required: true, trim: true, maxlength: 500 },
    completed: { type: Boolean, default: false },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: true }
);

export const Todo = mongoose.model<ITodoDocument>('Todo', todoSchema);

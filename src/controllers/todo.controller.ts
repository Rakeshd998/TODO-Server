import { Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Todo, type ITodoDocument } from '../models/Todo';
import ApiError from '../utils/ApiError';
import ApiResponse from '../utils/ApiResponse';
import asyncHandler from '../utils/asyncHandler';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const todoQuerySchema = z.object({
  page:      z.coerce.number().int().min(1).default(1),
  limit:     z.coerce.number().int().min(1).max(50).default(5),
  search:    z.string().optional(),
  startDate: z.string().optional(), // ISO date  e.g. "2025-01-01"
  endDate:   z.string().optional(), // ISO date  e.g. "2025-12-31"
});

const createTodoSchema = z.object({
  text: z.string().min(1, 'Todo text is required').max(500),
});

const updateTodoSchema = z
  .object({
    text:      z.string().min(1).max(500).optional(),
    completed: z.boolean().optional(),
  })
  .refine((data) => data.text !== undefined || data.completed !== undefined, {
    message: 'At least one field (text or completed) must be provided',
  });

// ─── Controllers ─────────────────────────────────────────────────────────────

// GET /api/todos?page=1&limit=5&search=keyword&startDate=2025-01-01&endDate=2025-12-31
export const getTodos = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const result = todoQuerySchema.safeParse(req.query);
  if (!result.success) {
    throw new ApiError(400, 'Invalid query parameters', result.error.errors.map((e) => e.message));
  }

  const { page, limit, search, startDate, endDate } = result.data;

  // Build filter dynamically
  const filter: mongoose.FilterQuery<ITodoDocument> = { userId: req.user!._id };

  if (search?.trim()) {
    filter.text = { $regex: search.trim(), $options: 'i' };
  }

  if (startDate || endDate) {
    filter.createdAt = {} as Record<string, Date>;
    if (startDate) {
      (filter.createdAt as Record<string, Date>).$gte = new Date(startDate);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999); // include the full end day
      (filter.createdAt as Record<string, Date>).$lte = end;
    }
  }

  // Run count and paginated fetch in parallel
  const [todos, total] = await Promise.all([
    Todo.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Todo.countDocuments(filter),
  ]);

  res.status(200).json(
    new ApiResponse(200, 'Todos fetched successfully', {
      todos,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }),
  );
});

// POST /api/todos
export const createTodo = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const result = createTodoSchema.safeParse(req.body);
  if (!result.success) {
    throw new ApiError(400, 'Validation failed', result.error.errors.map((e) => e.message));
  }

  const todo = await Todo.create({ text: result.data.text, userId: req.user!._id });
  res.status(201).json(new ApiResponse(201, 'Todo created', todo));
});

// PATCH /api/todos/:id
export const updateTodo = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const result = updateTodoSchema.safeParse(req.body);
  if (!result.success) {
    throw new ApiError(400, 'Validation failed', result.error.errors.map((e) => e.message));
  }

  const todo = await Todo.findOne({ _id: req.params.id, userId: req.user!._id });
  if (!todo) throw new ApiError(404, 'Todo not found');

  if (result.data.text !== undefined) todo.text = result.data.text;
  if (result.data.completed !== undefined) todo.completed = result.data.completed;

  await todo.save();
  res.status(200).json(new ApiResponse(200, 'Todo updated', todo));
});

// DELETE /api/todos/:id
export const deleteTodo = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const todo = await Todo.findOneAndDelete({ _id: req.params.id, userId: req.user!._id });
  if (!todo) throw new ApiError(404, 'Todo not found');

  res.status(200).json(new ApiResponse(200, 'Todo deleted'));
});

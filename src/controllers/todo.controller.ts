import { Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Todo, TODO_PRIORITIES, DATE_ONLY_REGEX, type ITodoDocument } from '../models/Todo';
import ApiError from '../utils/ApiError';
import ApiResponse from '../utils/ApiResponse';
import asyncHandler from '../utils/asyncHandler';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const dateOnly = z.string().regex(DATE_ONLY_REGEX, 'Date must be in YYYY-MM-DD format');

const todoQuerySchema = z
  .object({
    page:      z.coerce.number().int().min(1).default(1),
    limit:     z.coerce.number().int().min(1).max(50).default(5),
    search:    z.string().max(100).optional(),
    startDate: z.string().optional(), // created-at range, ISO date e.g. "2025-01-01"
    endDate:   z.string().optional(),
    due:       z.enum(['overdue', 'today']).optional(),
    today:     dateOnly.optional(),    // the client's local date — required with `due`
  })
  .refine((q) => !q.due || q.today, {
    message: '`today` (YYYY-MM-DD) is required when filtering by `due`',
  });

const statsQuerySchema = z.object({ today: dateOnly });

const createTodoSchema = z.object({
  text:     z.string().trim().min(1, 'Todo text is required').max(500),
  dueDate:  dateOnly.nullable().optional(),
  priority: z.enum(TODO_PRIORITIES).optional(),
});

const updateTodoSchema = z
  .object({
    text:      z.string().trim().min(1).max(500).optional(),
    completed: z.boolean().optional(),
    dueDate:   dateOnly.nullable().optional(), // null clears the due date
    priority:  z.enum(TODO_PRIORITIES).optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'At least one field must be provided',
  });

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Escape user input before using it in a $regex (prevents regex injection / ReDoS)
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Live (not trashed) todos belonging to the current user
const ownLiveTodos = (req: Request): mongoose.FilterQuery<ITodoDocument> => ({
  userId: req.user!._id,
  deletedAt: null,
});

const assertValidId = (id: string) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(404, 'Todo not found');
};

// ─── Controllers ─────────────────────────────────────────────────────────────

// GET /api/todos?page=1&limit=5&search=…&startDate=…&endDate=…&due=overdue|today&today=YYYY-MM-DD
export const getTodos = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const result = todoQuerySchema.safeParse(req.query);
  if (!result.success) {
    throw new ApiError(400, 'Invalid query parameters', result.error.errors.map((e) => e.message));
  }

  const { page, limit, search, startDate, endDate, due, today } = result.data;

  // Build filter dynamically
  const filter = ownLiveTodos(req);

  if (search?.trim()) {
    filter.text = { $regex: escapeRegex(search.trim()), $options: 'i' };
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

  // Due filters compare YYYY-MM-DD strings, which sort the same as the dates
  if (due === 'overdue') {
    filter.dueDate = { $ne: null, $lt: today };
    filter.completed = false;
  } else if (due === 'today') {
    filter.dueDate = today;
  }

  // Due-date views list the most urgent first; the default view is newest first
  const sort: Record<string, 1 | -1> = due ? { dueDate: 1, createdAt: -1 } : { createdAt: -1 };

  // Run count and paginated fetch in parallel
  const [todos, total] = await Promise.all([
    Todo.find(filter)
      .sort(sort)
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

// GET /api/todos/stats?today=YYYY-MM-DD — counts for the overview tile and filter chips
export const getTodoStats = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const result = statsQuerySchema.safeParse(req.query);
  if (!result.success) {
    throw new ApiError(400, 'Invalid query parameters', result.error.errors.map((e) => e.message));
  }
  const { today } = result.data;
  const base = ownLiveTodos(req);

  const [total, completed, dueToday, overdue] = await Promise.all([
    Todo.countDocuments(base),
    Todo.countDocuments({ ...base, completed: true }),
    Todo.countDocuments({ ...base, dueDate: today, completed: false }),
    Todo.countDocuments({ ...base, dueDate: { $ne: null, $lt: today }, completed: false }),
  ]);

  res.status(200).json(new ApiResponse(200, 'Todo stats', { total, completed, dueToday, overdue }));
});

// POST /api/todos
export const createTodo = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const result = createTodoSchema.safeParse(req.body);
  if (!result.success) {
    throw new ApiError(400, 'Validation failed', result.error.errors.map((e) => e.message));
  }

  const { text, dueDate, priority } = result.data;
  const todo = await Todo.create({
    text,
    dueDate: dueDate ?? null,
    ...(priority && { priority }),
    userId: req.user!._id,
  });
  res.status(201).json(new ApiResponse(201, 'Todo created', todo));
});

// PATCH /api/todos/:id
export const updateTodo = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const result = updateTodoSchema.safeParse(req.body);
  if (!result.success) {
    throw new ApiError(400, 'Validation failed', result.error.errors.map((e) => e.message));
  }
  assertValidId(req.params.id);

  const todo = await Todo.findOne({ _id: req.params.id, ...ownLiveTodos(req) });
  if (!todo) throw new ApiError(404, 'Todo not found');

  const { text, completed, dueDate, priority } = result.data;
  if (text !== undefined) todo.text = text;
  if (completed !== undefined) todo.completed = completed;
  if (dueDate !== undefined) todo.dueDate = dueDate;
  if (priority !== undefined) todo.priority = priority;

  await todo.save();
  res.status(200).json(new ApiResponse(200, 'Todo updated', todo));
});

// DELETE /api/todos/:id — moves the todo to the trash; it can be restored until
// MongoDB's TTL index purges it (see TRASH_TTL_SECONDS in the model)
export const deleteTodo = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  assertValidId(req.params.id);

  const todo = await Todo.findOneAndUpdate(
    { _id: req.params.id, ...ownLiveTodos(req) },
    { $set: { deletedAt: new Date() } },
  );
  if (!todo) throw new ApiError(404, 'Todo not found');

  res.status(200).json(new ApiResponse(200, 'Todo deleted', { id: todo._id }));
});

// POST /api/todos/:id/restore — undo a delete
export const restoreTodo = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  assertValidId(req.params.id);

  const todo = await Todo.findOneAndUpdate(
    { _id: req.params.id, userId: req.user!._id, deletedAt: { $ne: null } },
    { $set: { deletedAt: null } },
    { new: true },
  );
  if (!todo) throw new ApiError(404, 'This todo can no longer be restored');

  res.status(200).json(new ApiResponse(200, 'Todo restored', todo));
});

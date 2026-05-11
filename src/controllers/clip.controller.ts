import { Request, Response } from 'express';
import { z } from 'zod';
import { Clip } from '../models/Clip';
import ApiError from '../utils/ApiError';
import ApiResponse from '../utils/ApiResponse';
import asyncHandler from '../utils/asyncHandler';

// ─── Validation ───────────────────────────────────────────────────────────────

const createClipSchema = z.object({
  heading:    z.string().min(1, 'Heading is required').max(100).trim(),
  textToCopy: z.array(z.string().max(2000)).default([]),
});

const updateClipSchema = z.object({
  heading:    z.string().min(1).max(100).trim().optional(),
  textToCopy: z.array(z.string().max(2000)).optional(),
});

// ─── Controllers ─────────────────────────────────────────────────────────────

// GET /api/clips
export const getClips = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const clips = await Clip.find({ userId: req.user!._id }).sort({ createdAt: -1 });
  res.status(200).json(new ApiResponse(200, 'Clips fetched', clips));
});

// POST /api/clips
export const createClip = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const result = createClipSchema.safeParse(req.body);
  if (!result.success) {
    throw new ApiError(400, 'Validation failed', result.error.errors.map((e) => e.message));
  }
  const clip = await Clip.create({ ...result.data, userId: req.user!._id });
  res.status(201).json(new ApiResponse(201, 'Clip created', clip));
});

// PUT /api/clips/:id  — update heading and/or full textToCopy array
export const updateClip = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const result = updateClipSchema.safeParse(req.body);
  if (!result.success) {
    throw new ApiError(400, 'Validation failed', result.error.errors.map((e) => e.message));
  }
  const clip = await Clip.findOneAndUpdate(
    { _id: req.params.id, userId: req.user!._id },
    { $set: result.data },
    { new: true, runValidators: true },
  );
  if (!clip) throw new ApiError(404, 'Clip not found');
  res.status(200).json(new ApiResponse(200, 'Clip updated', clip));
});

// DELETE /api/clips/:id  — delete entire clip
export const deleteClip = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const clip = await Clip.findOneAndDelete({ _id: req.params.id, userId: req.user!._id });
  if (!clip) throw new ApiError(404, 'Clip not found');
  res.status(200).json(new ApiResponse(200, 'Clip deleted'));
});

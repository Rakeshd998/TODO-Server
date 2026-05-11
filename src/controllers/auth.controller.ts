import { Request, Response } from 'express';
import { z } from 'zod';
import { User } from '../models/User';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt';
import ApiError from '../utils/ApiError';
import ApiResponse from '../utils/ApiResponse';
import asyncHandler from '../utils/asyncHandler';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const registerSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

// ─── Cookie Options ───────────────────────────────────────────────────────────

const isProd = process.env.NODE_ENV === 'production';

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProd,                          // HTTPS only in production
  sameSite: isProd ? 'none' : 'strict',   // 'none' required for cross-origin (GitHub Pages → Render)
  maxAge: 7 * 24 * 60 * 60 * 1000,       // 7 days
  path: '/',
} as const;

// ─── Helper ───────────────────────────────────────────────────────────────────

const issueTokens = (userId: string, email: string) => ({
  accessToken: generateAccessToken(userId, email),
  refreshToken: generateRefreshToken(userId, email),
});

// ─── Controllers ─────────────────────────────────────────────────────────────

// POST /api/auth/register
export const register = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const result = registerSchema.safeParse(req.body);
  if (!result.success) {
    throw new ApiError(400, 'Validation failed', result.error.errors.map((e) => e.message));
  }

  const { name, email, password } = result.data;

  const existing = await User.findOne({ email });
  if (existing) throw new ApiError(409, 'Email already registered');

  const user = await User.create({ name, email, password });
  const { accessToken, refreshToken } = issueTokens(user._id.toString(), user.email);

  user.refreshTokens = [refreshToken];
  await user.save({ validateBeforeSave: false });

  res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS);
  res.status(201).json(
    new ApiResponse(201, 'Registration successful', { user, accessToken })
  );
});

// POST /api/auth/login
export const login = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const result = loginSchema.safeParse(req.body);
  if (!result.success) {
    throw new ApiError(400, 'Validation failed', result.error.errors.map((e) => e.message));
  }

  const { email, password } = result.data;

  // password field is select:false — must explicitly include it
  const user = await User.findOne({ email }).select('+password +refreshTokens');
  if (!user) throw new ApiError(401, 'Invalid email or password');

  const isMatch = await user.comparePassword(password);
  if (!isMatch) throw new ApiError(401, 'Invalid email or password');

  const { accessToken, refreshToken } = issueTokens(user._id.toString(), user.email);

  // Keep last 5 sessions (multi-device support)
  user.refreshTokens = [...user.refreshTokens.slice(-4), refreshToken];
  await user.save({ validateBeforeSave: false });

  res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS);
  res.status(200).json(
    new ApiResponse(200, 'Login successful', { user, accessToken })
  );
});

// POST /api/auth/refresh
export const refresh = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const incomingToken = req.cookies?.refreshToken as string | undefined;
  if (!incomingToken) throw new ApiError(401, 'Refresh token not found');

  const payload = verifyRefreshToken(incomingToken);

  const user = await User.findById(payload.userId).select('+refreshTokens');
  if (!user) throw new ApiError(401, 'User not found');

  const tokenIndex = user.refreshTokens.indexOf(incomingToken);

  // Reuse detection — token not in DB means it was already rotated (possible theft)
  if (tokenIndex === -1) {
    user.refreshTokens = []; // Invalidate ALL sessions as a security measure
    await user.save({ validateBeforeSave: false });
    throw new ApiError(403, 'Refresh token reuse detected. All sessions invalidated.');
  }

  // Rotate tokens
  const { accessToken, refreshToken: newRefreshToken } = issueTokens(
    user._id.toString(),
    user.email
  );

  user.refreshTokens.splice(tokenIndex, 1, newRefreshToken);
  await user.save({ validateBeforeSave: false });

  // Return user info (without sensitive fields) alongside the new access token
  // so the frontend can restore the user's name/email on page refresh.
  const { password: _pw, refreshTokens: _rt, ...safeUser } = user.toObject();

  res.cookie('refreshToken', newRefreshToken, REFRESH_COOKIE_OPTIONS);
  res.status(200).json(new ApiResponse(200, 'Tokens refreshed', { accessToken, user: safeUser }));
});

// POST /api/auth/logout
export const logout = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const incomingToken = req.cookies?.refreshToken as string | undefined;

  if (incomingToken) {
    try {
      const payload = verifyRefreshToken(incomingToken);
      const user = await User.findById(payload.userId).select('+refreshTokens');
      if (user) {
        user.refreshTokens = user.refreshTokens.filter((t) => t !== incomingToken);
        await user.save({ validateBeforeSave: false });
      }
    } catch {
      // Token already invalid — still clear the cookie
    }
  }

  res.clearCookie('refreshToken', { path: '/' });
  res.status(200).json(new ApiResponse(200, 'Logged out successfully'));
});

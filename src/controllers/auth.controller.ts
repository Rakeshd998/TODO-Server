import { Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { User } from '../models/User';
import { Todo } from '../models/Todo';
import { Clip } from '../models/Clip';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt';
import ApiError from '../utils/ApiError';
import ApiResponse from '../utils/ApiResponse';
import asyncHandler from '../utils/asyncHandler';
import { sendPasswordResetEmail } from '../utils/email';

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

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

const resetPasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
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

// POST /api/auth/forgot-password
export const forgotPassword = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const result = forgotPasswordSchema.safeParse(req.body);
  if (!result.success) {
    throw new ApiError(400, 'Validation failed', result.error.errors.map((e) => e.message));
  }

  const { email } = result.data;

  const user = await User.findOne({ email });
  // Always respond with success to prevent email enumeration attacks
  if (!user) {
    res.status(200).json(new ApiResponse(200, 'If that email is registered, a reset link has been sent.'));
    return;
  }

  // Generate a cryptographically secure random token
  const plainToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(plainToken).digest('hex');

  user.resetPasswordToken = hashedToken;
  user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await user.save({ validateBeforeSave: false });

  const clientUrl = process.env.CLIENT_URL ?? 'http://localhost:5173';
  const resetUrl = `${clientUrl}/reset-password/${plainToken}`;

  try {
    await sendPasswordResetEmail(email, resetUrl);
    res.status(200).json(new ApiResponse(200, 'If that email is registered, a reset link has been sent.'));
  } catch (err) {
    // Roll back — don't leave a dangling token if email fails
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save({ validateBeforeSave: false });
    console.error('Email send error:', err);
    throw new ApiError(500, 'Failed to send reset email. Please try again later.');
  }
});

// POST /api/auth/reset-password/:token
export const resetPassword = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const result = resetPasswordSchema.safeParse(req.body);
  if (!result.success) {
    throw new ApiError(400, 'Validation failed', result.error.errors.map((e) => e.message));
  }

  const { token } = req.params;
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: new Date() }, // must not be expired
  }).select('+resetPasswordToken +resetPasswordExpires +refreshTokens');

  if (!user) {
    throw new ApiError(400, 'Password reset token is invalid or has expired.');
  }

  // Update password and clear reset fields
  user.password = req.body.password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  // Invalidate all sessions for security
  user.refreshTokens = [];
  await user.save();

  res.clearCookie('refreshToken', { path: '/' });
  res.status(200).json(new ApiResponse(200, 'Password reset successful. Please log in with your new password.'));
});

// DELETE /api/auth/delete-account  (protected — requires authenticate middleware)
export const deleteAccount = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;

  // Delete all user data in parallel
  await Promise.all([
    Todo.deleteMany({ userId }),
    Clip.deleteMany({ userId }),
  ]);

  await User.findByIdAndDelete(userId);

  res.clearCookie('refreshToken', { path: '/' });
  res.status(200).json(new ApiResponse(200, 'Account deleted successfully.'));
});

import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { User } from '../models/User';
import ApiError from '../utils/ApiError';
import asyncHandler from '../utils/asyncHandler';

export const authenticate = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new ApiError(401, 'Access token required');
    }

    const token = authHeader.split(' ')[1];
    const payload = verifyAccessToken(token);

    if (payload.type !== 'access') {
      throw new ApiError(401, 'Invalid token type');
    }

    const user = await User.findById(payload.userId).select('-password -refreshTokens');
    if (!user) throw new ApiError(401, 'User no longer exists');

    req.user = user;
    next();
  }
);

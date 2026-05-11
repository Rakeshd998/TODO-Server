import jwt, { SignOptions } from 'jsonwebtoken';

export interface JwtPayload {
  userId: string;
  email: string;
  type: 'access' | 'refresh';
}

const getEnv = (key: string): string => {
  const val = process.env[key];
  if (!val) throw new Error(`${key} is not set in environment variables`);
  return val;
};

export const generateAccessToken = (userId: string, email: string): string =>
  jwt.sign(
    { userId, email, type: 'access' } as JwtPayload,
    getEnv('ACCESS_TOKEN_SECRET'),
    { expiresIn: (process.env.ACCESS_TOKEN_EXPIRY ?? '15m') } as SignOptions
  );

export const generateRefreshToken = (userId: string, email: string): string =>
  jwt.sign(
    { userId, email, type: 'refresh' } as JwtPayload,
    getEnv('REFRESH_TOKEN_SECRET'),
    { expiresIn: (process.env.REFRESH_TOKEN_EXPIRY ?? '7d') } as SignOptions
  );

export const verifyAccessToken = (token: string): JwtPayload =>
  jwt.verify(token, getEnv('ACCESS_TOKEN_SECRET')) as JwtPayload;

export const verifyRefreshToken = (token: string): JwtPayload =>
  jwt.verify(token, getEnv('REFRESH_TOKEN_SECRET')) as JwtPayload;

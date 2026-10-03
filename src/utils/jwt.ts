import crypto from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';

export interface JwtPayload {
  userId: string;
  email: string;
  type: 'access' | 'refresh';
  iat?: number; // issued-at, seconds since epoch (added by jsonwebtoken)
}

/**
 * True if the token was issued before the user's sessions were revoked.
 * Compared in whole seconds (JWT iat precision); tokens for the current session
 * are issued *after* the revocation timestamp is taken, so they always pass.
 */
export const isIssuedBeforeRevocation = (iat: number | undefined, revokedAt: Date | null | undefined): boolean =>
  !!revokedAt && iat !== undefined && iat < Math.floor(revokedAt.getTime() / 1000);

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
    {
      expiresIn: (process.env.REFRESH_TOKEN_EXPIRY ?? '7d'),
      // Unique id — two tokens issued for the same user in the same second would
      // otherwise be byte-identical, which breaks per-token rotation tracking
      jwtid: crypto.randomUUID(),
    } as SignOptions
  );

export const verifyAccessToken = (token: string): JwtPayload =>
  jwt.verify(token, getEnv('ACCESS_TOKEN_SECRET')) as JwtPayload;

export const verifyRefreshToken = (token: string): JwtPayload =>
  jwt.verify(token, getEnv('REFRESH_TOKEN_SECRET')) as JwtPayload;

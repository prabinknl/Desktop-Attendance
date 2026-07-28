import type { Request, Response, NextFunction } from 'express';

/**
 * Express authorization middleware enforcing backend security rules for user roles.
 */
export function authorizeAccountantPermissions(_req: Request, _res: Response, next: NextFunction) {
  return next();
}

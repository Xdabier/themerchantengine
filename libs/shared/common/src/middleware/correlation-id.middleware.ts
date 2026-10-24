import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

declare module 'express' {
  interface Request {
    /** Correlation ID for this request — set by CorrelationIdMiddleware. */
    id: string;
  }
}

/**
 * Middleware that assigns a correlation ID to every request.
 *
 * - If the caller provides X-Request-Id, that value is used as-is.
 * - Otherwise a new UUID v4 is generated.
 *
 * The ID is attached to `req.id` (for use in logs and downstream services)
 * and echoed back in the X-Request-Id response header.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incomingId = req.headers['x-request-id'] as string | undefined;
    const correlationId = incomingId?.trim() || uuidv4();

    req.id = correlationId;
    res.setHeader('X-Request-Id', correlationId);

    next();
  }
}

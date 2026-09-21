import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { RequestContext } from '../request-context';

/** Reads the RequestContext AuthGuard attached — never a client-supplied field (docs/03 §2.3). */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestContext => {
  const request = ctx.switchToHttp().getRequest<Request>();
  if (!request.requestContext) {
    throw new Error('CurrentUser used on a route without AuthGuard');
  }
  return request.requestContext;
});

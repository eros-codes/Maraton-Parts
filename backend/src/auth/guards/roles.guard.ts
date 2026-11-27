import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator';
import userRoleEnum from '../../users/enums/userRoleEnum';
import { SecurityEventsService } from '../../audit/security-events.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly securityEvents?: SecurityEventsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<userRoleEnum[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<
        Request & { user?: { role?: userRoleEnum; userId?: number } }
      >();
    const { user } = request;
    const allowed = !!user?.role && requiredRoles.includes(user.role);

    // A signed-in customer calling a staff route is not something the
    // panel or the store ever does - someone is probing.
    if (!allowed && this.securityEvents) {
      await this.securityEvents.record('security.admin_access_denied', {
        key: `user:${user?.userId ?? 'anonymous'}`,
        userId: user?.userId ?? null,
        ip: request.ip ?? null,
        route: `${request.method} ${(request.originalUrl ?? request.url).split('?')[0]}`,
      });
    }
    return allowed;
  }
}

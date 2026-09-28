import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { CommonModule } from './common/common.module';
import { AuthGuard } from './common/auth.guard';
import { EnvelopeInterceptor, GlobalExceptionFilter } from './common/http';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';
import { CasesController } from './cases/cases.controller';
import { CasesService } from './cases/cases.service';
import { MastersController } from './masters/masters.controller';
import { PayoutsController } from './payouts/payouts.controller';
import { DashboardController } from './dashboard/dashboard.controller';
import { NotificationsController } from './notifications/notifications.controller';
import { HealthController } from './health/health.controller';

@Module({
  imports: [CommonModule],
  controllers: [
    AuthController,
    UsersController,
    CasesController,
    MastersController,
    PayoutsController,
    DashboardController,
    NotificationsController,
    HealthController,
  ],
  providers: [
    AuthService,
    UsersService,
    CasesService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}

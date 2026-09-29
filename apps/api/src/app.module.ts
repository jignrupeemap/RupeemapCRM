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
import { InactivityController } from './inactivity/inactivity.controller';
import { InactivityService } from './inactivity/inactivity.service';
import { ReportsController } from './reports/reports.controller';
import { ChecklistsController } from './checklists/checklists.controller';
import { ChecklistsService } from './checklists/checklists.service';
import { KycController } from './kyc/kyc.controller';
import { KycService } from './kyc/kyc.service';
import { InsuranceController } from './insurance/insurance.controller';
import { InsuranceService } from './insurance/insurance.service';
import { BankersController } from './directory/bankers.controller';
import { BankCodesController } from './directory/bank-codes.controller';
import { TicketsController } from './tickets/tickets.controller';
import { TicketsService } from './tickets/tickets.service';
import { SlidersController } from './sliders/sliders.controller';
import { RecoveryController } from './recovery/recovery.controller';
import { RecoveryService } from './recovery/recovery.service';

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
    InactivityController,
    ReportsController,
    ChecklistsController,
    KycController,
    InsuranceController,
    BankersController,
    BankCodesController,
    TicketsController,
    SlidersController,
    RecoveryController,
  ],
  providers: [
    AuthService,
    UsersService,
    CasesService,
    InactivityService,
    ChecklistsService,
    KycService,
    InsuranceService,
    RecoveryService,
    TicketsService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}

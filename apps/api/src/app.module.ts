import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { PermissionsGuard } from './auth/permissions.guard';
import { HealthModule } from './health/health.module';
import { OrgsModule } from './orgs/orgs.module';
import { QueueModule } from './queue/queue.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { ConnectorsModule } from './connectors/connectors.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ContentModule } from './content/content.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { SettingsModule } from './settings/settings.module';
import { ConversationsModule } from './conversations/conversations.module';
import { LeadsModule } from './leads/leads.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { CalendarModule } from './calendar/calendar.module';
import { TelemetryModule } from './telemetry/telemetry.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    DbModule,
    AuthModule,
    HealthModule,
    OrgsModule,
    QueueModule,
    DiscoveryModule,
    ConnectorsModule,
    WebhooksModule,
    DashboardModule,
    ContentModule,
    ApprovalsModule,
    SettingsModule,
    ConversationsModule,
    LeadsModule,
    AnalyticsModule,
    CalendarModule,
    TelemetryModule,
  ],
  // Global guards run in registration order: throttle first (even for
  // unauthenticated traffic), then JWT auth (fail-closed — every route requires
  // a token unless `@Public()`), then RBAC permission checks. Controllers keep
  // their own `@RequirePermissions(...)`; auth/health/webhooks opt out via
  // `@Public()`.
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}

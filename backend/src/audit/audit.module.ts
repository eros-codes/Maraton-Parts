import { SecurityEventsService } from './security-events.service';
import { SecurityAlertsService } from './security-alerts.service';
import { SmsModule } from '../sms/sms.module';
import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { User } from '../users/entities/user.entity';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog, User]), SmsModule],
  controllers: [AuditController],
  providers: [AuditService, SecurityEventsService, SecurityAlertsService],
  exports: [AuditService, SecurityEventsService, SecurityAlertsService],
})
export class AuditModule {}

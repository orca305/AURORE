import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { LegalController } from './legal.controller.js';
import { LegalService } from './legal.service.js';
import { IngestGuard } from './ingest.guard.js';

@Module({
  imports: [PrismaModule],
  controllers: [LegalController],
  providers: [LegalService, IngestGuard],
  exports: [LegalService, IngestGuard],
})
export class LegalModule {}

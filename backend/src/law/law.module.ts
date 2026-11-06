import { Module } from '@nestjs/common';
import { LegalModule } from '../legal/legal.module.js';
import { LawController } from './law.controller.js';
import { LawService } from './law.service.js';

@Module({
  imports: [LegalModule],
  controllers: [LawController],
  providers: [LawService],
})
export class LawModule {}

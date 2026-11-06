import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { LawModule } from './law/law.module.js';
import { LegalModule } from './legal/legal.module.js';
import { CommonCodeController } from './common-code/common-code.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../.env',
    }),
    PrismaModule,
    LawModule,
    LegalModule,
  ],
  controllers: [AppController, CommonCodeController],
  providers: [AppService],
})
export class AppModule {}

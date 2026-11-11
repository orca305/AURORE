import { AdminController } from './admin/admin.controller.js';
import { AdminGuard } from './admin/admin.guard.js';
import { AdminService } from './admin/admin.service.js';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { ChatController, JobsController } from './chat/chat.controller.js';
import { ChatService } from './chat/chat.service.js';
import { ChatAnswerService } from './chat/answer.service.js';
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
      envFilePath: ['../local-dev/.env', '../.env'],
    }),
    PrismaModule,
    LawModule,
    LegalModule,
  ],
  controllers: [
    AdminController,
    AppController,
    CommonCodeController,
    AuthController,
    ChatController,
    JobsController,
  ],
  providers: [
    AppService,
    AuthService,
    ChatService,
    ChatAnswerService,
    AdminGuard,
    AdminService,
  ],
})
export class AppModule {}

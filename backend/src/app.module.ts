import {MolegTermsClient} from './terms/moleg-terms.js';
import {TermImportService} from './terms/term-import.service.js';
import {TermsService} from './terms/terms.service.js';
import {TermsController,AdminTermsController} from './terms/terms.controller.js';
import { AccountRetentionService } from './auth/account-retention.service.js';
import { NotificationsController } from './notifications/notifications.controller.js';
import { NotificationsService } from './notifications/notifications.service.js';
import { BookmarksController } from './bookmarks/bookmarks.controller.js';
import { BookmarksService } from './bookmarks/bookmarks.service.js';
import {
  DocumentsController,
  DocumentMemberGuard,
} from './documents/documents.controller.js';
import { DocumentsService } from './documents/documents.service.js';
import { CasesController } from './cases/cases.controller.js';
import { CasesService } from './cases/cases.service.js';
import { AdminPrecedentService } from './admin/admin-precedent.service.js';
import { AdminCorrectionService } from './admin/admin-correction.service.js';
import { AdminRefreshService } from './admin/admin-refresh.service.js';
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
    TermsController,AdminTermsController,
    NotificationsController,
    BookmarksController,
    DocumentsController,
    CasesController,
    AdminController,
    AppController,
    CommonCodeController,
    AuthController,
    ChatController,
    JobsController,
  ],
  providers: [
    MolegTermsClient,TermImportService,
    TermsService,
    AccountRetentionService,
    NotificationsService,
    BookmarksService,
    DocumentsService,
    DocumentMemberGuard,
    CasesService,
    AppService,
    AuthService,
    ChatService,
    ChatAnswerService,
    AdminGuard,
    AdminService,
    AdminRefreshService,
    AdminCorrectionService,
    AdminPrecedentService,
  ],
})
export class AppModule {}

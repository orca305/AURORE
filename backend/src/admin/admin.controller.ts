import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { AdminGuard } from './admin.guard.js';
import { AdminService } from './admin.service.js';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('session')
  @Header('Cache-Control', 'no-store')
  session() {
    return { admin: true };
  }

  @Get('overview')
  @Header('Cache-Control', 'no-store')
  overview() {
    return this.admin.overview();
  }
}

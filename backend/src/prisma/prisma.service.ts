import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(configService: ConfigService) {
    const connectionString = configService.getOrThrow<string>('DATABASE_URL');

    // The installed Prisma PostgreSQL adapter normalizes timestamps assuming UTC.
    // Pin every application connection, while preserving other startup options.
    const databaseUrl = new URL(connectionString);
    const options = databaseUrl.searchParams.get('options');
    databaseUrl.searchParams.set(
      'options',
      [options, '-c timezone=UTC'].filter(Boolean).join(' '),
    );
    const adapter = new PrismaPg({ connectionString: databaseUrl.href });

    super({
      adapter,
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<Server>;
  const token = 'test-only-credential-'.repeat(3);
  const row = {
    id: 1n,
    srcCd: 'LEGACY',
    srcKey: '001',
    legalNm: '테스트법',
    rgstDttm: new Date(),
    uptDttm: new Date(),
  };
  const db = {
    legal: {
      findMany: vi.fn().mockResolvedValue([row]),
      create: vi.fn().mockResolvedValue(row),
    },
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(ConfigService)
      .useValue(new ConfigService({ LEGAL_INGEST_TOKEN: token }))
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  it('신규·호환 조회 주소를 연결하고 조회 상한 초과를 거부한다', async () => {
    const result = await request(app.getHttpServer())
      .get('/legals?q=법')
      .expect(200);
    expect(result.body[0]).toMatchObject({ id: '1', legalNm: '테스트법' });
    const legacy = await request(app.getHttpServer()).get('/laws').expect(200);
    expect(legacy.body[0]).toMatchObject({
      id: '1',
      lawId: '001',
      lawName: '테스트법',
    });
    await request(app.getHttpServer()).get('/legals?limit=101').expect(400);
  });

  it('신규·호환 주소 모두 등록 인증과 입력 검증을 적용한다', async () => {
    await request(app.getHttpServer())
      .post('/legals')
      .send({ srcCd: 'LEGACY', srcKey: '001', legalNm: '법' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/laws')
      .send({ lawId: '001', lawName: '법' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/legals')
      .set('Authorization', `Bearer ${token}`)
      .send({ srcCd: 'LEGACY', srcKey: '001', legalNm: '법' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/legals')
      .set('Authorization', `Bearer ${token}`)
      .send({ srcCd: 'LEGACY', srcKey: '001', legalNm: '법', delYn: true })
      .expect(400);
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('AURORE API');
  });

  afterEach(async () => {
    await app.close();
  });
});

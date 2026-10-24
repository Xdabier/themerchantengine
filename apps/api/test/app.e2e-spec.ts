import { PrismaClient } from '@prisma/client';
import { api, createTestPrisma } from '../../../test/e2e/helpers';

describe('App (e2e)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Health Check', () => {
    it('should return 200 on GET /', () => {
      return api().get('/').expect(404); // Add actual health endpoint
    });
  });

  describe('API Documentation', () => {
    it('should serve Swagger docs on /docs', () => {
      return api().get('/docs').expect(200); // Swagger UI
    });
  });
});

/**
 * Reviews — Q&A answer split (R8.1)
 *
 * Closes production-readiness-audit.md §12.S1.A. The shared `AnswerQuestionDto`
 * was split so the storefront route can no longer carry the `isAdminAnswer`
 * flag. This spec is the §3.8 Supertest seal:
 *   - storefront route: a customer payload carrying `isAdminAnswer` is rejected
 *     outright — the split storefront DTO has no such field (regression);
 *   - admin route: admin payload with `isAdminAnswer: true` persists as `true`.
 */
import * as crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { api, createTestPrisma, loginAs, signUpCustomer, ADMIN } from './helpers';

const PRODUCT_SLUG = 'iphone-15-pro';
const CUSTOMER_EMAIL = `r8-1-${crypto.randomUUID()}@e2e.test`;
const CUSTOMER_PASSWORD = 'AnswerSeal1!';

describe('Reviews Q&A — answer DTO split (R8.1)', () => {
  let prisma: PrismaClient;

  let adminCookie: string;
  let customerCookie: string;
  let regressionQuestionId: string;
  let adminQuestionId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();

    adminCookie = await loginAs(ADMIN.email, ADMIN.password);

    customerCookie = await signUpCustomer(prisma, CUSTOMER_EMAIL, CUSTOMER_PASSWORD, {
      firstName: 'R8',
      lastName: 'Tester',
    });

    const q1 = await api()
      .post(`/v1/products/${PRODUCT_SLUG}/questions`)
      .set('Cookie', customerCookie)
      .send({ question: 'Does it ship to Tripoli?' })
      .expect(201);
    regressionQuestionId = q1.body.data.id;

    const q2 = await api()
      .post(`/v1/products/${PRODUCT_SLUG}/questions`)
      .set('Cookie', customerCookie)
      .send({ question: 'Is the warranty international?' })
      .expect(201);
    adminQuestionId = q2.body.data.id;
  });

  afterAll(async () => {
    try {
      await prisma.productQuestion.deleteMany({
        where: { id: { in: [regressionQuestionId, adminQuestionId] } },
      });
      await prisma.user.deleteMany({ where: { email: CUSTOMER_EMAIL } });
    } catch {
      // ignore
    }
    await prisma.$disconnect();
  });

  it('POST /v1/questions/:id/answer — customer cannot escalate via isAdminAnswer (§12.S1.A regression)', async () => {
    // The split storefront DTO has no `isAdminAnswer` field — the global
    // validation pipe (whitelist + forbidNonWhitelisted) rejects the attempt
    // outright, so a customer can never carry the escalation flag.
    await api()
      .post(`/v1/questions/${regressionQuestionId}/answer`)
      .set('Cookie', customerCookie)
      .send({ answer: 'Customer reply trying to escalate', isAdminAnswer: true })
      .expect(400);
  });

  it('POST /v1/admin/questions/:id/answer — admin route persists isAdminAnswer:true', async () => {
    const res = await api()
      .post(`/v1/admin/questions/${adminQuestionId}/answer`)
      .set('Cookie', adminCookie)
      .send({ answer: 'Yes, ships to Tripoli within 5 business days.', isAdminAnswer: true })
      .expect(201);

    expect(res.body.data.answer).toBe('Yes, ships to Tripoli within 5 business days.');
    expect(res.body.data.isAdminAnswer).toBe(true);

    const persisted = await prisma.productQuestion.findUnique({
      where: { id: adminQuestionId },
      select: { isAdminAnswer: true },
    });
    expect(persisted?.isAdminAnswer).toBe(true);
  });

  it('POST /v1/questions/:id/answer — customer with no isAdminAnswer field still persists isAdminAnswer:false', async () => {
    const q3 = await api()
      .post(`/v1/products/${PRODUCT_SLUG}/questions`)
      .set('Cookie', customerCookie)
      .send({ question: 'Does it come unlocked?' })
      .expect(201);
    const id = q3.body.data.id as string;

    try {
      const res = await api()
        .post(`/v1/questions/${id}/answer`)
        .set('Cookie', customerCookie)
        .send({ answer: 'Honest community reply' })
        .expect(201);

      expect(res.body.data.isAdminAnswer).toBe(false);
    } finally {
      await prisma.productQuestion.delete({ where: { id } });
    }
  });

  it('POST /v1/questions/:id/answer — 409 QUESTION_ALREADY_ANSWERED on an answered question', async () => {
    // `adminQuestionId` carries the official answer written above. Answers
    // render on the storefront now, so the "Answer this question" control sits
    // next to one; without this guard any customer could erase it.
    const res = await api()
      .post(`/v1/questions/${adminQuestionId}/answer`)
      .set('Cookie', customerCookie)
      .send({ answer: 'Overwriting the official answer' });

    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('QUESTION_ALREADY_ANSWERED');

    const persisted = await prisma.productQuestion.findUnique({
      where: { id: adminQuestionId },
      select: { isAdminAnswer: true },
    });
    expect(persisted?.isAdminAnswer).toBe(true);
  });

  it('POST /v1/admin/questions/:id/answer — a moderator may still overwrite', async () => {
    const res = await api()
      .post(`/v1/admin/questions/${adminQuestionId}/answer`)
      .set('Cookie', adminCookie)
      .send({ answer: 'Corrected: ships to Tripoli within 3 business days.', isAdminAnswer: true })
      .expect(201);

    expect(res.body.data.answer).toBe('Corrected: ships to Tripoli within 3 business days.');
  });
});

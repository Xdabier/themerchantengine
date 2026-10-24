// Canary fixture. Never imported by application code.
// raw-sql-approved: full-text search ranking needs tsvector operators; reviewed by the O2 gate.
export class ApprovedService {
  constructor(private readonly prisma: { $queryRaw: (q: TemplateStringsArray) => Promise<unknown> }) {}

  search(): Promise<unknown> {
    return this.prisma.$queryRaw`SELECT 1`;
  }
}

// Canary fixture. Never imported by application code.
export class BadService {
  constructor(private readonly prisma: { $queryRaw: (q: TemplateStringsArray) => Promise<unknown> }) {}

  find(): Promise<unknown> {
    return this.prisma.$queryRaw`SELECT * FROM "Product"`;
  }
}

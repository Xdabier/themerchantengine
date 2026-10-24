import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import type { PrismaClient } from '@prisma/client';
import { ingestImage } from '../lib/image-pipeline';
import { createLocalStorageDriver } from '../lib/storage';

interface CreatedAsset {
  url: string;
  variants: Record<string, { webp: { url: string }; avif: { url: string } }>;
}

/** A fresh DB on every run, as the e2e harness gives the seed after a reset. */
function fakePrisma(created: CreatedAsset[]): PrismaClient {
  return {
    asset: {
      findFirst: async () => null,
      create: async ({ data }: { data: CreatedAsset }) => {
        created.push(data);
        return data;
      },
    },
  } as unknown as PrismaClient;
}

/**
 * The storage sidecar survives a DB reset, so the second seed of the same
 * image takes the cache-hit path. The URLs it plants must follow the uploads
 * base of the run that seeds, not the one that wrote the sidecar: the e2e API
 * on :53001 cannot serve a :53000 URL.
 */
describe('image-pipeline sidecar cache', () => {
  let tmp: string;

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('rebases cached URLs onto the current uploads base', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'seed-cache-'));
    const sourcePath = path.join(tmp, 'source.png');
    await fs.writeFile(
      sourcePath,
      await sharp({
        create: { width: 320, height: 240, channels: 3, background: { r: 10, g: 20, b: 30 } },
      })
        .png()
        .toBuffer(),
    );
    const uploadsRoot = path.join(tmp, 'uploads');
    const alt = { default: 'Sample', en: 'Sample', fr: 'Exemple' };

    const first: CreatedAsset[] = [];
    await ingestImage({
      prisma: fakePrisma(first),
      storage: createLocalStorageDriver({ uploadsRoot, baseUrl: 'http://localhost:53000/uploads' }),
      sourcePath,
      alt,
    });

    const second: CreatedAsset[] = [];
    await ingestImage({
      prisma: fakePrisma(second),
      storage: createLocalStorageDriver({ uploadsRoot, baseUrl: 'http://localhost:53001/uploads' }),
      sourcePath,
      alt,
    });

    const base = 'http://localhost:53001/uploads/';
    expect(second[0].url.startsWith(base)).toBe(true);
    const urls = Object.values(second[0].variants).flatMap((v) => [v.webp.url, v.avif.url]);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url.startsWith(base), url).toBe(true);
  });

  it('rebases a surviving Asset row onto the current uploads base', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'seed-cache-'));
    const sourcePath = path.join(tmp, 'source.png');
    await fs.writeFile(
      sourcePath,
      await sharp({
        create: { width: 320, height: 240, channels: 3, background: { r: 40, g: 50, b: 60 } },
      })
        .png()
        .toBuffer(),
    );
    const uploadsRoot = path.join(tmp, 'uploads');
    const alt = { default: 'Sample', en: 'Sample', fr: 'Exemple' };

    // Asset rows survive a reseed, so the second run takes the DB-hit path.
    const rows = new Map<string, CreatedAsset & { id: string; storagePath: string }>();
    const prisma = {
      asset: {
        findFirst: async () => [...rows.values()][0] ?? null,
        create: async ({ data }: { data: CreatedAsset & { id: string; storagePath: string } }) => {
          rows.set(data.id, data);
          return data;
        },
        update: async ({ where, data }: { where: { id: string }; data: Partial<CreatedAsset> }) => {
          const row = { ...rows.get(where.id)!, ...data };
          rows.set(where.id, row);
          return row;
        },
      },
    } as unknown as PrismaClient;

    await ingestImage({
      prisma,
      storage: createLocalStorageDriver({ uploadsRoot, baseUrl: 'http://localhost:53000/uploads' }),
      sourcePath,
      alt,
    });
    await ingestImage({
      prisma,
      storage: createLocalStorageDriver({ uploadsRoot, baseUrl: 'http://localhost:53001/uploads' }),
      sourcePath,
      alt,
    });

    const [row] = [...rows.values()];
    const base = 'http://localhost:53001/uploads/';
    expect(row.url.startsWith(base), row.url).toBe(true);
    const urls = Object.values(row.variants).flatMap((v) => [v.webp.url, v.avif.url]);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url.startsWith(base), url).toBe(true);
  });
});

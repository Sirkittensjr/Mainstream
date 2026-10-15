/**
 * The qualities the image optimiser is asked for, against the ones it allows.
 *
 * next.config.mjs lists the allowed qualities, and Next refuses any other with
 * a 400. A component asking for one that is not listed gets a broken image and
 * no error anywhere a developer would look — which is how every profile's
 * background photo disappeared: ProfileBackdrop asked for 70 after the list
 * became 75 and 90. These tests use Next's own validation and the project's own
 * config, so they fail the way production did.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ImageOptimizerCache } from 'next/dist/server/image-optimizer';
import { imageConfigDefault } from 'next/dist/shared/lib/image-config';
import nextConfig from '../../next.config.mjs';
import { IMAGE_QUALITY } from './image';

const allowed: number[] = nextConfig.images?.qualities ?? [];
const images = { ...imageConfigDefault, ...nextConfig.images };

/** What Next's optimiser says to a request, exactly as /_next/image would. */
function optimiserAnswer(url: string, quality: number): string {
  const result = ImageOptimizerCache.validateParams(
    { headers: { accept: 'image/avif,image/webp,*/*' } } as never,
    { url, w: '1920', q: String(quality) },
    { images } as never,
    false,
  );
  return 'errorMessage' in result ? result.errorMessage : 'ok';
}

const STORED = 'https://abcdefgh.supabase.co/storage/v1/object/public/faytarra-media/media/u/cover.jpg';

describe('image qualities', () => {
  it('IMAGE_QUALITY is exactly the list next.config.mjs allows', () => {
    assert.deepEqual(
      [...new Set(Object.values(IMAGE_QUALITY))].sort((a, b) => a - b),
      [...allowed].sort((a, b) => a - b),
    );
  });

  it("the optimiser serves every IMAGE_QUALITY, for a picture in the project's bucket", () => {
    for (const quality of Object.values(IMAGE_QUALITY)) {
      assert.equal(optimiserAnswer(STORED, quality), 'ok', `quality ${quality}`);
    }
  });

  it('and refuses anything else — the 400 that blanked every background photo', () => {
    assert.equal(optimiserAnswer(STORED, 70), '"q" parameter (quality) of 70 is not allowed');
  });

  it('every `quality` an image in the app asks for is one the optimiser allows', () => {
    const root = path.join(process.cwd(), 'src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(full);
      }
    };
    walk(root);

    /** The number an expression stands for: a literal, IMAGE_QUALITY.x, or a const in the same file. */
    const resolve = (expression: string, source: string, depth = 0): number | undefined => {
      const text = expression.trim();
      if (/^\d+$/.test(text)) return Number(text);
      const named = /^IMAGE_QUALITY\.(\w+)$/.exec(text);
      if (named) return (IMAGE_QUALITY as Record<string, number>)[named[1]];
      const local = depth < 3 && new RegExp(`const ${text}\\s*=\\s*([^;]+);`).exec(source);
      return local ? resolve(local[1], source, depth + 1) : undefined;
    };

    const asked: { file: string; expression: string; value: number | undefined }[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\bquality=\{([^}]+)\}/g)) {
        asked.push({ file: path.relative(root, file), expression: match[1], value: resolve(match[1], source) });
      }
    }

    // Not a vacuous pass: the two pictures that ask for a quality were found.
    const where = asked.map((a) => a.file);
    assert.ok(where.includes(path.join('components', 'ProfileBackdrop.tsx')), where.join(', '));
    assert.ok(where.includes(path.join('components', 'PostCard.tsx')), where.join(', '));

    for (const { file, expression, value } of asked) {
      assert.ok(
        value !== undefined && allowed.includes(value),
        `${file}: quality={${expression}} is ${value ?? 'not a known number'}; next.config.mjs allows ${allowed.join(', ')}`,
      );
    }
  });
});

import {
  assetAltText,
  assetStatusTone,
  assetTypeLabel,
  bytesOf,
  formatBytes,
  formatDimensions,
  isImage,
  isVideo,
} from './assets.utils';

describe('assets utils', () => {
  it('assetStatusTone maps status to tone', () => {
    expect(assetStatusTone('READY')).toBe('success');
    expect(assetStatusTone('FAILED')).toBe('error');
    expect(assetStatusTone('PROCESSING')).toBe('warning');
    expect(assetStatusTone(undefined)).toBe('neutral');
  });

  it('assetTypeLabel handles unknown + known', () => {
    expect(assetTypeLabel('IMAGE')).toBe('Image');
    expect(assetTypeLabel(undefined)).toBe('Unknown');
  });

  it('isVideo / isImage detect via type or mime', () => {
    expect(isVideo({ type: 'VIDEO' })).toBe(true);
    expect(isVideo({ mimeType: 'video/mp4' })).toBe(true);
    expect(isImage({ mimeType: 'image/webp' })).toBe(true);
    expect(isImage({})).toBe(false);
  });

  it('bytesOf reads fileSize, falls back to bytes', () => {
    expect(bytesOf({ fileSize: 100 })).toBe(100);
    expect(bytesOf({ bytes: 200 })).toBe(200);
    expect(bytesOf({})).toBeNull();
  });

  it('formatBytes scales into KB/MB/GB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(2_000_000)).toMatch(/MB/);
    expect(formatBytes(null)).toBe('—');
  });

  it('formatDimensions surfaces WxH or em-dash', () => {
    expect(formatDimensions({ width: 1024, height: 768 })).toBe('1024×768');
    expect(formatDimensions(null)).toBe('—');
    expect(formatDimensions({ width: null, height: null })).toBe('—');
  });

  it('assetAltText resolves in the operator locale', () => {
    const alt = { fr: 'Fraise', en: 'Bur', default: 'Bur' };
    expect(assetAltText({ id: 'a', alt }, 'fr', 'xx')).toBe('Fraise');
    expect(assetAltText({ id: 'a', alt }, 'en', 'xx')).toBe('Bur');
  });

  it('assetAltText falls back to default, then the first populated value', () => {
    expect(assetAltText({ id: 'a', alt: { en: 'A', default: 'D' } }, 'fr', 'xx')).toBe('D');
    expect(assetAltText({ id: 'a', alt: { default: 'D' } }, 'fr', 'xx')).toBe('D');
    expect(assetAltText({ id: 'a', alt: { de: 'Hallo' } }, 'fr', 'xx')).toBe('Hallo');
    expect(assetAltText({ id: 'a', alt: 'plain' }, 'fr', 'xx')).toBe('plain');
    expect(assetAltText({ id: 'a' }, 'fr', 'xx')).toBe('');
  });
});

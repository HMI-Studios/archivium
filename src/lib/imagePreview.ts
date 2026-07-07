import sharp from 'sharp';
import logger from '../logger';

const PREVIEW_WIDTH = 24;
const PREVIEW_JPEG_QUALITY = 40;

export async function generatePreview(buffer: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(buffer)
      .resize({ width: PREVIEW_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: PREVIEW_JPEG_QUALITY })
      .toBuffer();
  } catch (err) {
    logger.error(err);
    return null;
  }
}

export function previewToDataUri(preview?: Buffer | null): string | null {
  if (!preview) return null;
  return `data:image/jpeg;base64,${preview.toString('base64')}`;
}

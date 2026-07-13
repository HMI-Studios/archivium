import db from '.';
import { executeQuery } from '../api/utils';
import { generatePreview } from '../lib/imagePreview';

async function main() {
  const rows = await executeQuery('SELECT id FROM image WHERE preview IS NULL') as { id: number }[];
  console.log(`Found ${rows.length} images without a preview.`);

  for (let i = 0; i < rows.length; i++) {
    const { id } = rows[i];
    const [dataRows] = await db.execute('SELECT data FROM image WHERE id = ?', [id]);
    const row = (dataRows as { data: Buffer }[])[0];
    if (!row) continue;

    const preview = await generatePreview(row.data);
    if (preview) {
      await db.execute('UPDATE image SET preview = ? WHERE id = ?', [preview, id]);
    }
    console.log(`(${i + 1}/${rows.length}) image ${id}: ${preview ? 'generated' : 'skipped (unsupported format)'}`);
  }

  console.log('Done.');
  db.end();
}

if (require.main === module) {
  main();
}

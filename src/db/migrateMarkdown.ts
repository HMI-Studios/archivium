import { generateJSON } from '@tiptap/html/server';
import readline from 'readline';
import db from '.';
import { GalleryImage } from '../api/models/item';
import { executeQuery } from '../api/utils';
import { editorExtensions } from '../lib/editor';
import { renderMarkdown } from '../lib/markdownRender';
import { jsonToIndexed } from '../lib/tiptapHelpers';

async function main() {
  const items = await executeQuery(`
    SELECT item.id, item.shortname, item.obj_data, universe.shortname as universe_short
    FROM item
    INNER JOIN universe ON universe.id = item.universe_id
  `);
  let count = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const objData = JSON.parse(item.obj_data);
    if (typeof objData.body !== 'string') continue;
    console.log(`Migrating... (${i}/${items.length})`);

    const gallery = await executeQuery(`
      SELECT
        image.id, image.name, itemimage.label
      FROM itemimage
      INNER JOIN image ON image.id = itemimage.image_id
      WHERE itemimage.item_id = ?
    `, [item.id]) as GalleryImage[];

    const html = await renderMarkdown(item.universe_short, objData.body, { item: { ...item, obj_data: objData, gallery } });
    const json = generateJSON(html, editorExtensions(false));
    const indexed = jsonToIndexed(json);
    objData.body = indexed;
    await executeQuery('UPDATE item SET obj_data = ? WHERE id = ?', [JSON.stringify(objData), item.id]);
    readline.moveCursor(process.stdout, 0, -1);
    count++;
  }
  console.log(`Migrated ${count} of ${items.length} items to JSON.`);

  const chapters = await executeQuery(`
    SELECT sc.id, sc.chapter_number, sc.body, universe.shortname as universe_short
    FROM storychapter AS sc
    INNER JOIN story ON story.id = sc.story_id
    INNER JOIN universe ON universe.id = story.universe_id
  `);
  count = 0;
  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    if (typeof chapter.body !== 'string') continue;
    console.log(`Migrating... (${i}/${items.length})`);

    const html = await renderMarkdown(chapter.universe_short, chapter.body, {});
    const json = generateJSON(html, editorExtensions(false));
    const indexed = jsonToIndexed(json);
    await executeQuery('UPDATE storychapter SET body = ? WHERE id = ?', [JSON.stringify(indexed), chapter.id]);
    readline.moveCursor(process.stdout, 0, -1);
    count++;
  }
  console.log(`Migrated ${count} of ${chapters.length} chapters to JSON.`);

  const notes = await executeQuery(`
    SELECT note.id, note.body, universe.shortname AS universe_short
    FROM note
    LEFT JOIN itemnote AS itn ON itn.note_id = note.id
    LEFT JOIN item ON item.id = itn.item_id
    LEFT JOIN universe ON universe.id = item.universe_id
  `);
  count = 0;
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    if (typeof note.body !== 'string') continue;
    console.log(`Migrating... (${i}/${notes.length})`);

    const html = await renderMarkdown(note.universe_short, note.body, {});
    const json = generateJSON(html, editorExtensions(false));
    const indexed = jsonToIndexed(json);
    await executeQuery('UPDATE note SET body = ? WHERE id = ?', [JSON.stringify(indexed), note.id]);
    readline.moveCursor(process.stdout, 0, -1);
    count++;
  }
  console.log(`Migrated ${count} of ${chapters.length} chapters to JSON.`);

  db.end();
}

if (require.main === module) {
  main();
}

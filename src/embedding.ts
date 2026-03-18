import { QdrantClient } from '@qdrant/js-client-rest';
import { Item } from './api/models/item';
import { Universe } from './api/models/universe';
import { executeQuery } from './api/utils';
import { createHash } from './lib/hashUtils';
import { getTextContent, IndexedDocument, indexedToJson } from './lib/tiptapHelpers';
import logger from './logger';
import { LMSTER_KEY } from './config';
import { ResultSetHeader } from 'mysql2';
import { User } from './api/models/user';
import api from './api';

const COLLECTION_NAME = 'archivium-embeds';

const qdrantClient = new QdrantClient({ host: 'localhost', port: 6333 });

async function ensureCollection() {
  logger.info('Starting Qdrant...');
  const collections = await qdrantClient.getCollections()

  const exists = collections.collections.some(c => c.name === COLLECTION_NAME);

  if (!exists) {
    await qdrantClient.createCollection(COLLECTION_NAME, {
      vectors: {
        size: 768,
        distance: 'Cosine',
      }
    });
  }
}
ensureCollection();

type Job = {
  type: 'check' | 'embed' | 'search' | 'reembed',
  itemId?: number,
  data?: Record<string, unknown>,
};

type Chunk = {
  text: string,
  path: string,
  size: number,
  scope: string,
};

export type FetchedChunk = {
  id: number,
  chunk_id: string,
  item_id: number,
  scope: string,
  heading_path: string,
  content: string,
  token_count: 63,
  hash: string,
  score: number,
};

export type SearchOptions = {
  query: string,
  universeId?: number,
  limit?: number,
};

export type ItemSearchResults = {
  item: Item,
  chunks: FetchedChunk[],
  topScore: number,
};

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class Embedder {
  private isRunning: boolean = false;
  private queue: Job[] = [];
  private loggerInterval: NodeJS.Timeout;

  constructor() {}

  public async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info('Embedder: starting...');
    this.loggerInterval = setInterval(() => {
      logger.info(`Embedder: ${this.queue.length} jobs in queue...`)
    }, 2000);
    while (this.isRunning) {
      await this.nextJob();
      if (this.queue.length === 0) break;
    }
    logger.info('Embedder: queue empty, stopping...');
    this.stop();
  }

  public stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    clearInterval(this.loggerInterval);
  }

  public addJob(job: Job) {
    this.queue.push(job);
    if (!this.isRunning) {
      this.start();
    }
  }

  public async enableEmbed(universe: Universe) {
    const items = await executeQuery('SELECT id FROM item WHERE universe_id = ?', [universe.id]) as Item[];
    logger.info(`Enabling semantic search for ${universe.title} with ${items.length} items to check...`);
    for (const { id } of items) {
      this.addJob({ type: 'check', itemId: id });
    }
    this.start();
  }

  private async nextJob() {
    const job = this.queue.shift();
    if (!job) return;
    try {
      if (job.type === 'check') {
        await this.checkItem(job.itemId as number);
      } else if (job.type === 'embed') {
        await this.embedChunk(
          job.itemId as number,
          job.data?.itemTitle as string,
          job.data?.itemType as string,
          job.data?.universeId as number,
          job.data?.chunk as Chunk,
          job.data?.id as string,
        );
      } else if (job.type === 'reembed') {
        await this.reembedItem(job.itemId as number);
      } else if (job.type === 'search') {
        await this.doSearch(
          job.data?.user as User | undefined,
          job.data?.options as SearchOptions,
          job.data?.resolve as (results: FetchedChunk[]) => void,
        );
      }
    } catch (err) {
      console.error(err);
      logger.error(`Bad job: ${JSON.stringify(job)}`);
    }
  }

  private async checkItem(id: number) {
    const item = (await executeQuery('SELECT * FROM item WHERE id = ?', [id]))[0] as Item; // TODO...
    if (!item || !item.obj_data) return;
    item.obj_data = JSON.parse(item.obj_data as string);
    if (!item.obj_data.body) return;
    const chunks = this.calculateChunks(item.obj_data.body);
    const existingChunks: Record<string, any> = (
      await executeQuery('SELECT * FROM itemembeddedchunks WHERE item_id = ?', [id])
    ).reduce((acc, chunk) => ({ ...acc, [chunk.chunk_id]: chunk }), {});
    let index = 0;
    for (const chunk of chunks) {
      const hash = createHash(chunk.text);
      const chunkId = `${id}_${index}`;
      if (chunkId in existingChunks) {
        if (!(hash === existingChunks[chunkId].hash && chunk.text === existingChunks[chunkId].content)) {
          await executeQuery('DELETE FROM itemembeddedchunks WHERE id = ?', [existingChunks[chunkId].id]);
          await qdrantClient.delete(COLLECTION_NAME, {
            wait: true,
            points: [existingChunks[chunkId].id],
          });
          this.addJob({
            type: 'embed',
            itemId: id,
            data: { chunk, itemTitle: item.title, itemType: item.item_type, universeId: item.universe_id, id: chunkId },
          });
        }
        delete existingChunks[chunkId];
      }
      else {
        this.addJob({
          type: 'embed',
          itemId: id,
          data: { chunk, itemTitle: item.title, itemType: item.item_type, universeId: item.universe_id, id: chunkId },
        });
      }

      index++;
    }
    for (const chunkId in existingChunks) {
      await executeQuery('DELETE FROM itemembeddedchunks WHERE id = ?', [existingChunks[chunkId].id]);
      await qdrantClient.delete(COLLECTION_NAME, {
        wait: true,
        points: [existingChunks[chunkId].id],
      });
    }
  }

  private calculateChunks(indexed: IndexedDocument): Chunk[] {
    const MAX_SIZE = 700;
    const MIN_SIZE = 200;

    try {
      const body = indexedToJson(indexed);
      const chunks: Chunk[] = [];

      const bodyContent = getTextContent(body.content);
      chunks.push({
        text: bodyContent,
        path: '',
        size: Math.round(bodyContent.split(/\s+/).length * 1.3),
        scope: 'item',
      });

      let currentChunk: Chunk = { text: '', path: '', size: 0, scope: 'section' };
      for (const node of body.content) {
        const content = getTextContent(node);
        const tokenCount = Math.round(content.split(/\s+/).length * 1.3);
        if (node.type === 'heading' && currentChunk.size > MIN_SIZE) {
          chunks.push({
            ...currentChunk,
            text: currentChunk.text.trim(),
          });
          currentChunk = { text: '', path: content, size: 0, scope: 'section' };
        } else if (currentChunk.size + tokenCount > MAX_SIZE) {
          chunks.push({
            ...currentChunk,
            text: currentChunk.text.trim(),
          });
          currentChunk = { text: '', path: currentChunk.path, size: 0, scope: 'section' };
        }
        currentChunk.text += `${content}\n\n`;
        currentChunk.size += tokenCount;
      }
      chunks.push({
        ...currentChunk,
        text: currentChunk.text.trim(),
      });

      return chunks;
    } catch (err) {
      logger.error(err);
      return [];
    }
  }

  private async embedChunk(itemId: number, itemTitle: string, itemType: string, universeId: number, chunk: Chunk, chunkId: string) {
    const embedText = `search_document:
      Item: ${itemTitle}
      Item Category: ${itemType}
      ${chunk.path ? `Section: ${chunk.path}` : ''}

      ${chunk.text}
    `;

    const response = await fetch("http://hmi.dynu.net:1234/v1/embeddings", {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LMSTER_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-nomic-embed-text-v1.5',
        input: embedText,
      })
    });

    const hash = createHash(chunk.text);
    const { insertId } = await executeQuery<ResultSetHeader>(`
      INSERT INTO itemembeddedchunks
      (chunk_id, item_id, scope, heading_path, content, token_count, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [chunkId, itemId, chunk.scope, chunk.path, chunk.text, chunk.size, hash]);

    const { data } = await response.json();
    const vector = data[0].embedding;
    const payload = { universeId, itemId, itemTitle, itemType, chunkId, path: chunk.path, scope: chunk.scope };

    await qdrantClient.upsert(COLLECTION_NAME, {
      wait: true,
      points: [{ id: insertId, vector, payload }],
    });
  }

  public async reembedItem(id: number) {
    const { affectedRows } = await executeQuery<ResultSetHeader>('DELETE FROM itemembeddedchunks WHERE item_id = ?', [id]);
    if (affectedRows > 0) {
      await qdrantClient.delete(COLLECTION_NAME, {
        wait: true,
        filter: {
          must: [
            {
              key: 'itemId',
              match: { value: id },
            },
          ],
        },
      });
    }
    this.addJob({ type: 'check', itemId: id });
  }

  private async doSearch(user: User | undefined, options: SearchOptions, resolve: (results: FetchedChunk[]) => void): Promise<void> {
    const universes = await api.universe.getMany(user);

    const response = await fetch("http://hmi.dynu.net:1234/v1/embeddings", {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LMSTER_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-nomic-embed-text-v1.5',
        input: `search_query: ${options.query}`,
      })
    });

    const { data } = await response.json();
    const vector = data[0].embedding;
    const filters: Record<string, unknown>[] = [
      {
        key: 'universeId',
        match: { any: universes.map(u => u.id) },
      },
    ];
    if (options.universeId) {
      filters.push(
        {
          key: 'universeId',
          match: { value: Number(options.universeId) },
        },
      );
    }
    const { points } = await qdrantClient.query(COLLECTION_NAME, {
      query: vector,
      limit: options.limit ?? 20,
      filter: {
        must: filters,
      },
    });
    const scoreMap = points.reduce((acc, row) => ({ ...acc, [row.id]: row.score }), {});

    const chunkIds = points.map(r => Number(r.id));
    if (chunkIds.length === 0) return resolve([]);
    const chunks = await executeQuery(
      `SELECT * FROM itemembeddedchunks WHERE id IN (${chunkIds.map(() => '?').join(',')})`,
      [...chunkIds],
    ) as FetchedChunk[];

    resolve(
      chunks
        .map(r => ({ ...r, score: scoreMap[r.id] }))
        .filter(r => r.score >= 0.6)
        .sort((a, b) => a.score > b.score ? -1 : 1)
    );
  }

  public async search(user: User | undefined, options: SearchOptions): Promise<ItemSearchResults[]> {
    const data: FetchedChunk[] = await new Promise((resolve) => {
      this.addJob({
        type: 'search',
        data: { user, options, resolve },
      })
    });

    const fetchedItems: { [id: number]: ItemSearchResults } = {};
    for (const chunk of data) {
      if (!(chunk.item_id in fetchedItems)) {
        const item = await api.item.getOne(user, { 'item.id': chunk.item_id });
        fetchedItems[chunk.item_id] = {
          item,
          chunks: [],
          topScore: 0,
        };
      }
      fetchedItems[chunk.item_id].chunks.push(chunk);
      fetchedItems[chunk.item_id].topScore = Math.max(fetchedItems[chunk.item_id].topScore, chunk.score);
    }

    return Object.values(fetchedItems).sort((a, b) => a.topScore > b.topScore ? -1 : 1);
  }
}

const embedder = new Embedder();
export default embedder;

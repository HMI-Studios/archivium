import { QdrantClient } from '@qdrant/js-client-rest';
import { Item } from './api/models/item';
import { Universe } from './api/models/universe';
import { executeQuery, perms } from './api/utils';
import { createHash } from './lib/hashUtils';
import { getTextContent, IndexedDocument, indexedToJson } from './lib/tiptapHelpers';
import logger from './logger';
import { EMBEDDING_API_URL, LMSTER_KEY, QDRANT_URL } from './config';
import { ResultSetHeader } from 'mysql2';
import { User } from './api/models/user';
import api from './api';

const COLLECTION_NAME = 'archivium-embeds';
const EMBEDDING_MODEL = 'text-embedding-nomic-embed-text-v1.5';
const EMBED_TIMEOUT_MS = 20_000;
const EMBED_RETRY_DELAY_MS = 1_000;
const MIN_RELEVANCE_SCORE = 0.6;
const MAX_CHUNK_CHARS = 8_000;
const VECTOR_DIMENSIONS = 768;

// Embedding may not always be available - we need to handle the case when it's not.
const EMBEDDING_ENABLED = Boolean(EMBEDDING_API_URL);

const qdrantClient = new QdrantClient({ url: QDRANT_URL });

async function requestEmbedding(input: string): Promise<number[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await waitFor(EMBED_RETRY_DELAY_MS);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
    try {
      const response = await fetch(EMBEDDING_API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${LMSTER_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input,
        }),
      });

      if (!response.ok) {
        throw new Error(`Embedding request failed: ${response.status} ${response.statusText}`);
      }

      const { data } = await response.json();
      const vector = data?.[0]?.embedding;
      if (!Array.isArray(vector)) {
        throw new Error('Embedding response missing data[0].embedding');
      }

      return vector;
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastErr;
}

async function ensureCollection() {
  logger.info('Starting Qdrant...');
  const collections = await qdrantClient.getCollections()

  const exists = collections.collections.some(c => c.name === COLLECTION_NAME);

  if (!exists) {
    await qdrantClient.createCollection(COLLECTION_NAME, {
      vectors: {
        size: VECTOR_DIMENSIONS,
        distance: 'Cosine',
      }
    });
  }
}
if (EMBEDDING_ENABLED) {
  ensureCollection().catch(err => logger.error(`Embedder: failed to initialize Qdrant collection: ${err}`));
} else {
  logger.warn('Embedder: EMBEDDING_API_URL not configured, semantic search disabled.');
}

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
  token_count: number,
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
    if (!EMBEDDING_ENABLED) return;
    this.queue.push(job);
    if (!this.isRunning) {
      this.start();
    }
  }

  public async enableEmbed(universe: Universe) {
    if (!EMBEDDING_ENABLED) return;
    const items = await executeQuery('SELECT id FROM item WHERE universe_id = ?', [universe.id]) as Item[];
    logger.info(`Enabling semantic search for ${universe.title} with ${items.length} items to check...`);
    for (const { id } of items) {
      this.addJob({ type: 'check', itemId: id });
    }
    this.start();
  }

  // Must be called before items/universes are deleted to ensure embeddings are cleaned up!
  public async deleteForItem(itemId: number): Promise<void> {
    if (!EMBEDDING_ENABLED) return;
    await qdrantClient.delete(COLLECTION_NAME, {
      wait: true,
      filter: {
        must: [{ key: 'itemId', match: { value: itemId } }],
      },
    });
  }

  public async deleteForUniverse(universeId: number): Promise<void> {
    if (!EMBEDDING_ENABLED) return;
    await qdrantClient.delete(COLLECTION_NAME, {
      wait: true,
      filter: {
        must: [{ key: 'universeId', match: { value: universeId } }],
      },
    });
  }

  public async getStatsForUniverse(universeId: number): Promise<{ chunkCount: number, itemCount: number, estimatedBytes: number }> {
    const [row] = await executeQuery(`
      SELECT COUNT(*) AS chunkCount, COUNT(DISTINCT item_id) AS itemCount
      FROM itemembeddedchunks
      INNER JOIN item ON item.id = itemembeddedchunks.item_id
      WHERE item.universe_id = ?
    `, [universeId]);

    const chunkCount = Number(row?.chunkCount ?? 0);
    return {
      chunkCount,
      itemCount: Number(row?.itemCount ?? 0),
      estimatedBytes: chunkCount * VECTOR_DIMENSIONS * 4,
    };
  }

  public async getRelatedItems(user: User | undefined, itemId: number, universeId: number, limit = 6): Promise<Item[]> {
    if (!EMBEDDING_ENABLED) return [];
    try {
      const [ownChunk] = await executeQuery(
        `SELECT id FROM itemembeddedchunks WHERE item_id = ? AND scope = 'item' LIMIT 1`,
        [itemId],
      );
      if (!ownChunk) return [];

      const { points } = await qdrantClient.query(COLLECTION_NAME, {
        query: ownChunk.id,
        limit: limit * 5,
        filter: {
          must: [{ key: 'universeId', match: { value: universeId } }],
          must_not: [{ key: 'itemId', match: { value: itemId } }],
        },
      });
      if (points.length === 0) return [];

      const chunkIds = points.map(p => Number(p.id));
      const chunks = await executeQuery(
        `SELECT id, item_id FROM itemembeddedchunks WHERE id IN (${chunkIds.map(() => '?').join(',')})`,
        chunkIds,
      );
      const itemIdByChunkId = new Map(chunks.map(c => [c.id, c.item_id]));

      const bestScoreByItem = new Map<number, number>();
      for (const point of points) {
        const relatedItemId = itemIdByChunkId.get(Number(point.id));
        if (relatedItemId === undefined) continue;
        const best = bestScoreByItem.get(relatedItemId);
        if (best === undefined || point.score > best) bestScoreByItem.set(relatedItemId, point.score);
      }

      const rankedIds = [...bestScoreByItem.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([id]) => id);
      if (rankedIds.length === 0) return [];

      const items = await Promise.all(rankedIds.map(id =>
        api.item.getOne(user, { 'item.id': id }, perms.READ).catch(() => null)
      ));
      return items.filter((item): item is Item => !!item);
    } catch (err) {
      logger.error(`Failed to get related items for item ${itemId}: ${err}`);
      return [];
    }
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
      const reject = job.data?.reject as ((err: unknown) => void) | undefined;
      reject?.(err);
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

      const bodyContent = body.content.map(getTextContent).join('\n\n').slice(0, MAX_CHUNK_CHARS);
      chunks.push({
        text: bodyContent,
        path: '',
        size: Math.round(bodyContent.split(/\s+/).length * 1.3),
        scope: 'item',
      });

      const pushChunk = (chunk: Chunk) => {
        const text = chunk.text.trim();
        if (text.length > MAX_CHUNK_CHARS) {
          logger.warn(`Embedding chunk exceeded ${MAX_CHUNK_CHARS} chars, truncating (item chunk path: "${chunk.path}")`);
        }
        chunks.push({ ...chunk, text: text.slice(0, MAX_CHUNK_CHARS) });
      };

      let currentChunk: Chunk = { text: '', path: '', size: 0, scope: 'section' };
      for (const node of body.content) {
        const content = getTextContent(node);
        const tokenCount = Math.round(content.split(/\s+/).length * 1.3);
        if (node.type === 'heading' && currentChunk.size > MIN_SIZE) {
          pushChunk(currentChunk);
          currentChunk = { text: '', path: content, size: 0, scope: 'section' };
        } else if (currentChunk.size + tokenCount > MAX_SIZE) {
          pushChunk(currentChunk);
          currentChunk = { text: '', path: currentChunk.path, size: 0, scope: 'section' };
        }
        currentChunk.text += `${content}\n\n`;
        currentChunk.size += tokenCount;
      }
      pushChunk(currentChunk);

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

    const vector = await requestEmbedding(embedText);

    const hash = createHash(chunk.text);
    const { insertId } = await executeQuery<ResultSetHeader>(`
      INSERT INTO itemembeddedchunks
      (chunk_id, item_id, scope, heading_path, content, token_count, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [chunkId, itemId, chunk.scope, chunk.path, chunk.text, chunk.size, hash]);

    const payload = { universeId, itemId, itemTitle, itemType, chunkId, path: chunk.path, scope: chunk.scope };

    await qdrantClient.upsert(COLLECTION_NAME, {
      wait: true,
      points: [{ id: insertId, vector, payload }],
    });
  }

  public async reembedItem(id: number) {
    if (!EMBEDDING_ENABLED) return;
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
    const searchableUniverseIds = universes
      .filter(u => {
        try {
          return !!u.obj_data?.semanticSearchEnabled;
        } catch {
          return false;
        }
      })
      .map(u => u.id);

    if (searchableUniverseIds.length === 0) return resolve([]);

    const vector = await requestEmbedding(`search_query: ${options.query}`);
    const filters: Record<string, unknown>[] = [
      {
        key: 'universeId',
        match: { any: searchableUniverseIds },
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
    // Over-fetch chunks since multiple chunks can belong to the same item; search() truncates to options.limit items.
    const itemLimit = options.limit ?? 20;
    const { points } = await qdrantClient.query(COLLECTION_NAME, {
      query: vector,
      limit: itemLimit * 5,
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
        .filter(r => r.score >= MIN_RELEVANCE_SCORE)
        .sort((a, b) => a.score > b.score ? -1 : 1)
    );
  }

  public async search(user: User | undefined, options: SearchOptions): Promise<ItemSearchResults[]> {
    if (!EMBEDDING_ENABLED) return [];
    const data: FetchedChunk[] = await new Promise((resolve, reject) => {
      this.addJob({
        type: 'search',
        data: { user, options, resolve, reject },
      })
    });

    const fetchedItems: { [id: number]: ItemSearchResults } = {};
    for (const chunk of data) {
      if (!(chunk.item_id in fetchedItems)) {
        let item: Item;
        try {
          item = await api.item.getOne(user, { 'item.id': chunk.item_id });
        } catch (err) {
          logger.warn(`Semantic search: skipping item ${chunk.item_id}, failed to fetch: ${err}`);
          continue;
        }
        fetchedItems[chunk.item_id] = {
          item,
          chunks: [],
          topScore: 0,
        };
      }
      fetchedItems[chunk.item_id].chunks.push(chunk);
      fetchedItems[chunk.item_id].topScore = Math.max(fetchedItems[chunk.item_id].topScore, chunk.score);
    }

    return Object.values(fetchedItems)
      .sort((a, b) => a.topScore > b.topScore ? -1 : 1)
      .slice(0, options.limit ?? 20);
  }
}

const embedder = new Embedder();
export default embedder;

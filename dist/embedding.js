"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const js_client_rest_1 = require("@qdrant/js-client-rest");
const utils_1 = require("./api/utils");
const hashUtils_1 = require("./lib/hashUtils");
const tiptapHelpers_1 = require("./lib/tiptapHelpers");
const logger_1 = __importDefault(require("./logger"));
const config_1 = require("./config");
const api_1 = __importDefault(require("./api"));
const COLLECTION_NAME = 'archivium-embeds';
const EMBEDDING_MODEL = 'text-embedding-nomic-embed-text-v1.5';
const EMBED_TIMEOUT_MS = 20_000;
const EMBED_RETRY_DELAY_MS = 1_000;
const MIN_RELEVANCE_SCORE = 0.6;
const MAX_CHUNK_CHARS = 8_000;
const VECTOR_DIMENSIONS = 768;
const qdrantClient = new js_client_rest_1.QdrantClient({ host: 'localhost', port: 6333 });
async function requestEmbedding(input) {
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0)
            await waitFor(EMBED_RETRY_DELAY_MS);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
        try {
            const response = await fetch(config_1.EMBEDDING_API_URL, {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Authorization': `Bearer ${config_1.LMSTER_KEY}`,
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
        }
        catch (err) {
            lastErr = err;
        }
        finally {
            clearTimeout(timeout);
        }
    }
    throw lastErr;
}
async function ensureCollection() {
    logger_1.default.info('Starting Qdrant...');
    const collections = await qdrantClient.getCollections();
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
ensureCollection();
function waitFor(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
class Embedder {
    isRunning = false;
    queue = [];
    loggerInterval;
    constructor() { }
    async start() {
        if (this.isRunning)
            return;
        this.isRunning = true;
        logger_1.default.info('Embedder: starting...');
        this.loggerInterval = setInterval(() => {
            logger_1.default.info(`Embedder: ${this.queue.length} jobs in queue...`);
        }, 2000);
        while (this.isRunning) {
            await this.nextJob();
            if (this.queue.length === 0)
                break;
        }
        logger_1.default.info('Embedder: queue empty, stopping...');
        this.stop();
    }
    stop() {
        if (!this.isRunning)
            return;
        this.isRunning = false;
        clearInterval(this.loggerInterval);
    }
    addJob(job) {
        this.queue.push(job);
        if (!this.isRunning) {
            this.start();
        }
    }
    async enableEmbed(universe) {
        const items = await (0, utils_1.executeQuery)('SELECT id FROM item WHERE universe_id = ?', [universe.id]);
        logger_1.default.info(`Enabling semantic search for ${universe.title} with ${items.length} items to check...`);
        for (const { id } of items) {
            this.addJob({ type: 'check', itemId: id });
        }
        this.start();
    }
    // Must be called before items/universes are deleted to ensure embeddings are cleaned up!
    async deleteForItem(itemId) {
        await qdrantClient.delete(COLLECTION_NAME, {
            wait: true,
            filter: {
                must: [{ key: 'itemId', match: { value: itemId } }],
            },
        });
    }
    async deleteForUniverse(universeId) {
        await qdrantClient.delete(COLLECTION_NAME, {
            wait: true,
            filter: {
                must: [{ key: 'universeId', match: { value: universeId } }],
            },
        });
    }
    async getStatsForUniverse(universeId) {
        const [row] = await (0, utils_1.executeQuery)(`
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
    // Must never throw: this backs a page-render path that should degrade silently
    // (empty list) rather than break the item page if the embedding subsystem is down.
    async getRelatedItems(user, itemId, universeId, limit = 6) {
        try {
            const [ownChunk] = await (0, utils_1.executeQuery)(`SELECT id FROM itemembeddedchunks WHERE item_id = ? AND scope = 'item' LIMIT 1`, [itemId]);
            if (!ownChunk)
                return [];
            const { points } = await qdrantClient.query(COLLECTION_NAME, {
                query: ownChunk.id,
                limit: limit * 5,
                filter: {
                    must: [{ key: 'universeId', match: { value: universeId } }],
                    must_not: [{ key: 'itemId', match: { value: itemId } }],
                },
            });
            if (points.length === 0)
                return [];
            const chunkIds = points.map(p => Number(p.id));
            const chunks = await (0, utils_1.executeQuery)(`SELECT id, item_id FROM itemembeddedchunks WHERE id IN (${chunkIds.map(() => '?').join(',')})`, chunkIds);
            const itemIdByChunkId = new Map(chunks.map(c => [c.id, c.item_id]));
            const bestScoreByItem = new Map();
            for (const point of points) {
                const relatedItemId = itemIdByChunkId.get(Number(point.id));
                if (relatedItemId === undefined)
                    continue;
                const best = bestScoreByItem.get(relatedItemId);
                if (best === undefined || point.score > best)
                    bestScoreByItem.set(relatedItemId, point.score);
            }
            const rankedIds = [...bestScoreByItem.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, limit)
                .map(([id]) => id);
            if (rankedIds.length === 0)
                return [];
            const items = await Promise.all(rankedIds.map(id => api_1.default.item.getOne(user, { 'item.id': id }, utils_1.perms.READ).catch(() => null)));
            return items.filter((item) => !!item);
        }
        catch (err) {
            logger_1.default.error(`Failed to get related items for item ${itemId}: ${err}`);
            return [];
        }
    }
    async nextJob() {
        const job = this.queue.shift();
        if (!job)
            return;
        try {
            if (job.type === 'check') {
                await this.checkItem(job.itemId);
            }
            else if (job.type === 'embed') {
                await this.embedChunk(job.itemId, job.data?.itemTitle, job.data?.itemType, job.data?.universeId, job.data?.chunk, job.data?.id);
            }
            else if (job.type === 'reembed') {
                await this.reembedItem(job.itemId);
            }
            else if (job.type === 'search') {
                await this.doSearch(job.data?.user, job.data?.options, job.data?.resolve);
            }
        }
        catch (err) {
            console.error(err);
            logger_1.default.error(`Bad job: ${JSON.stringify(job)}`);
            const reject = job.data?.reject;
            reject?.(err);
        }
    }
    async checkItem(id) {
        const item = (await (0, utils_1.executeQuery)('SELECT * FROM item WHERE id = ?', [id]))[0]; // TODO...
        if (!item || !item.obj_data)
            return;
        item.obj_data = JSON.parse(item.obj_data);
        if (!item.obj_data.body)
            return;
        const chunks = this.calculateChunks(item.obj_data.body);
        const existingChunks = (await (0, utils_1.executeQuery)('SELECT * FROM itemembeddedchunks WHERE item_id = ?', [id])).reduce((acc, chunk) => ({ ...acc, [chunk.chunk_id]: chunk }), {});
        let index = 0;
        for (const chunk of chunks) {
            const hash = (0, hashUtils_1.createHash)(chunk.text);
            const chunkId = `${id}_${index}`;
            if (chunkId in existingChunks) {
                if (!(hash === existingChunks[chunkId].hash && chunk.text === existingChunks[chunkId].content)) {
                    await (0, utils_1.executeQuery)('DELETE FROM itemembeddedchunks WHERE id = ?', [existingChunks[chunkId].id]);
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
            await (0, utils_1.executeQuery)('DELETE FROM itemembeddedchunks WHERE id = ?', [existingChunks[chunkId].id]);
            await qdrantClient.delete(COLLECTION_NAME, {
                wait: true,
                points: [existingChunks[chunkId].id],
            });
        }
    }
    calculateChunks(indexed) {
        const MAX_SIZE = 700;
        const MIN_SIZE = 200;
        try {
            const body = (0, tiptapHelpers_1.indexedToJson)(indexed);
            const chunks = [];
            const bodyContent = body.content.map(tiptapHelpers_1.getTextContent).join('\n\n').slice(0, MAX_CHUNK_CHARS);
            chunks.push({
                text: bodyContent,
                path: '',
                size: Math.round(bodyContent.split(/\s+/).length * 1.3),
                scope: 'item',
            });
            const pushChunk = (chunk) => {
                const text = chunk.text.trim();
                if (text.length > MAX_CHUNK_CHARS) {
                    logger_1.default.warn(`Embedding chunk exceeded ${MAX_CHUNK_CHARS} chars, truncating (item chunk path: "${chunk.path}")`);
                }
                chunks.push({ ...chunk, text: text.slice(0, MAX_CHUNK_CHARS) });
            };
            let currentChunk = { text: '', path: '', size: 0, scope: 'section' };
            for (const node of body.content) {
                const content = (0, tiptapHelpers_1.getTextContent)(node);
                const tokenCount = Math.round(content.split(/\s+/).length * 1.3);
                if (node.type === 'heading' && currentChunk.size > MIN_SIZE) {
                    pushChunk(currentChunk);
                    currentChunk = { text: '', path: content, size: 0, scope: 'section' };
                }
                else if (currentChunk.size + tokenCount > MAX_SIZE) {
                    pushChunk(currentChunk);
                    currentChunk = { text: '', path: currentChunk.path, size: 0, scope: 'section' };
                }
                currentChunk.text += `${content}\n\n`;
                currentChunk.size += tokenCount;
            }
            pushChunk(currentChunk);
            return chunks;
        }
        catch (err) {
            logger_1.default.error(err);
            return [];
        }
    }
    async embedChunk(itemId, itemTitle, itemType, universeId, chunk, chunkId) {
        const embedText = `search_document:
      Item: ${itemTitle}
      Item Category: ${itemType}
      ${chunk.path ? `Section: ${chunk.path}` : ''}

      ${chunk.text}
    `;
        const vector = await requestEmbedding(embedText);
        const hash = (0, hashUtils_1.createHash)(chunk.text);
        const { insertId } = await (0, utils_1.executeQuery)(`
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
    async reembedItem(id) {
        const { affectedRows } = await (0, utils_1.executeQuery)('DELETE FROM itemembeddedchunks WHERE item_id = ?', [id]);
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
    async doSearch(user, options, resolve) {
        const universes = await api_1.default.universe.getMany(user);
        const searchableUniverseIds = universes
            .filter(u => {
            try {
                return !!u.obj_data?.semanticSearchEnabled;
            }
            catch {
                return false;
            }
        })
            .map(u => u.id);
        if (searchableUniverseIds.length === 0)
            return resolve([]);
        const vector = await requestEmbedding(`search_query: ${options.query}`);
        const filters = [
            {
                key: 'universeId',
                match: { any: searchableUniverseIds },
            },
        ];
        if (options.universeId) {
            filters.push({
                key: 'universeId',
                match: { value: Number(options.universeId) },
            });
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
        if (chunkIds.length === 0)
            return resolve([]);
        const chunks = await (0, utils_1.executeQuery)(`SELECT * FROM itemembeddedchunks WHERE id IN (${chunkIds.map(() => '?').join(',')})`, [...chunkIds]);
        resolve(chunks
            .map(r => ({ ...r, score: scoreMap[r.id] }))
            .filter(r => r.score >= MIN_RELEVANCE_SCORE)
            .sort((a, b) => a.score > b.score ? -1 : 1));
    }
    async search(user, options) {
        const data = await new Promise((resolve, reject) => {
            this.addJob({
                type: 'search',
                data: { user, options, resolve, reject },
            });
        });
        const fetchedItems = {};
        for (const chunk of data) {
            if (!(chunk.item_id in fetchedItems)) {
                let item;
                try {
                    item = await api_1.default.item.getOne(user, { 'item.id': chunk.item_id });
                }
                catch (err) {
                    logger_1.default.warn(`Semantic search: skipping item ${chunk.item_id}, failed to fetch: ${err}`);
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
exports.default = embedder;

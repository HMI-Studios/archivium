"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = loadMcp;
const streamableHttp_js_1 = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const api_1 = __importDefault(require("../api"));
const config_1 = require("../config");
const logger_1 = __importDefault(require("../logger"));
const server_1 = require("./server");
/**
 * PHASE 1 authentication: a single static bearer token (MCP_BEARER_TOKEN) that
 * maps to one configured Archivium user (MCP_BEARER_USER). This lets us validate
 * the tools with the MCP Inspector before the full OAuth layer (Phase 2) exists.
 * When OAuth lands, this is replaced by the SDK's requireBearerAuth backed by the
 * OAuth provider; the tool code in server.ts is unchanged.
 */
async function authenticate(req) {
    const header = req.headers['authorization'];
    if (typeof header !== 'string' || !header.startsWith('Bearer '))
        return null;
    const token = header.slice('Bearer '.length).trim();
    if (!config_1.MCP_BEARER_TOKEN || token !== config_1.MCP_BEARER_TOKEN)
        return null;
    const user = await api_1.default.user.getOne({ 'user.username': config_1.MCP_BEARER_USER }).catch(() => null);
    return user ?? null;
}
function unauthorized(res) {
    res.set('WWW-Authenticate', 'Bearer realm="archivium-mcp"');
    res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized.' },
        id: null,
    });
}
function methodNotAllowed(_req, res, next) {
    res.status(405).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null,
    });
    next();
}
function loadMcp(app) {
    if (!config_1.MCP_BEARER_TOKEN || !config_1.MCP_BEARER_USER) {
        logger_1.default.info('MCP server disabled (set MCP_BEARER_TOKEN and MCP_BEARER_USER to enable).');
        return;
    }
    app.post('/mcp', async (req, res, next) => {
        const user = await authenticate(req);
        if (!user) {
            unauthorized(res);
            return next();
        }
        try {
            const server = (0, server_1.buildMcpServer)(user);
            const transport = new streamableHttp_js_1.StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,
                enableJsonResponse: true,
            });
            res.on('close', () => {
                transport.close();
                server.close();
            });
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
            logger_1.default.info(`MCP call - method: ${req.body.method}, tool: ${req.body.params?.name}, args: ${JSON.stringify(req.body.params?.arguments)}`);
        }
        catch (err) {
            logger_1.default.error(err);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: '2.0',
                    error: { code: -32603, message: 'Internal server error.' },
                    id: null,
                });
            }
            next();
        }
    });
    app.get('/mcp', methodNotAllowed);
    app.delete('/mcp', methodNotAllowed);
    logger_1.default.info('MCP server mounted at /mcp');
}

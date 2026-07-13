"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = loadMcp;
const streamableHttp_js_1 = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const router_js_1 = require("@modelcontextprotocol/sdk/server/auth/router.js");
const bearerAuth_js_1 = require("@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js");
const api_1 = __importDefault(require("../api"));
const config_1 = require("../config");
const logger_1 = __importDefault(require("../logger"));
const server_1 = require("./server");
const oauth_1 = require("./oauth");
const issuerUrl = new URL(`https://${config_1.DOMAIN}`);
const resourceServerUrl = new URL(`https://${config_1.DOMAIN}/mcp`);
const resourceMetadataUrl = (0, router_js_1.getOAuthProtectedResourceMetadataUrl)(resourceServerUrl);
const provider = new oauth_1.ArchiviumOAuthProvider();
async function resolveUser(req) {
    const userId = req.auth?.extra?.userId;
    if (typeof userId !== 'number')
        return null;
    return api_1.default.user.getOne({ 'user.id': userId }).catch(() => null);
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
    // The view layer's global middleware preemptively sets Content-Type: text/html
    // on every request; Express's res.json()/res.send() won't override a header
    // that's already set, so without this, all OAuth/MCP JSON responses (and
    // error bodies) would be mislabeled as text/html despite serving valid JSON.
    app.use((req, res, next) => {
        res.removeHeader('Content-Type');
        next();
    });
    app.use((0, router_js_1.mcpAuthRouter)({
        provider,
        issuerUrl,
        resourceServerUrl,
        resourceName: 'Archivium',
    }));
    const bearerAuth = (0, bearerAuth_js_1.requireBearerAuth)({ verifier: provider, resourceMetadataUrl });
    app.post('/mcp', bearerAuth, async (req, res, next) => {
        const user = await resolveUser(req);
        if (!user) {
            res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized.' }, id: null });
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
        }
        next();
    });
    app.get('/mcp', bearerAuth, methodNotAllowed);
    app.delete('/mcp', bearerAuth, methodNotAllowed);
    logger_1.default.info('MCP server mounted at /mcp (OAuth 2.1)');
}

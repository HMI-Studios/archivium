import { Express, Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import api from '../api';
import { MCP_BEARER_TOKEN, MCP_BEARER_USER } from '../config';
import logger from '../logger';
import { User } from '../api/models/user';
import { buildMcpServer } from './server';

/**
 * PHASE 1 authentication: a single static bearer token (MCP_BEARER_TOKEN) that
 * maps to one configured Archivium user (MCP_BEARER_USER). This lets us validate
 * the tools with the MCP Inspector before the full OAuth layer (Phase 2) exists.
 * When OAuth lands, this is replaced by the SDK's requireBearerAuth backed by the
 * OAuth provider; the tool code in server.ts is unchanged.
 */
async function authenticate(req: Request): Promise<User | null> {
  const header = req.headers['authorization'];
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  if (!MCP_BEARER_TOKEN || token !== MCP_BEARER_TOKEN) return null;
  const user = await api.user.getOne({ 'user.username': MCP_BEARER_USER }).catch(() => null);
  return user ?? null;
}

function unauthorized(res: Response): void {
  res.set('WWW-Authenticate', 'Bearer realm="archivium-mcp"');
  res.status(401).json({
    jsonrpc: '2.0',
    error: { code: -32001, message: 'Unauthorized.' },
    id: null,
  });
}

function methodNotAllowed(_req: Request, res: Response, next: () => void): void {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  });
  next();
}

export default function loadMcp(app: Express): void {
  if (!MCP_BEARER_TOKEN || !MCP_BEARER_USER) {
    logger.info('MCP server disabled (set MCP_BEARER_TOKEN and MCP_BEARER_USER to enable).');
    return;
  }

  app.post('/mcp', async (req, res, next) => {
    const user = await authenticate(req);
    if (!user) {
      unauthorized(res);
      return next();
    }

    try {
      const server = buildMcpServer(user);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      logger.info(`MCP call - method: ${req.body.method}, tool: ${req.body.params?.name}, args: ${JSON.stringify(req.body.params?.arguments)}`);
    } catch (err) {
      logger.error(err);
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

  logger.info('MCP server mounted at /mcp');
}

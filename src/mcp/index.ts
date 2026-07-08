import { Express, Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import api from '../api';
import { DOMAIN } from '../config';
import logger from '../logger';
import { User } from '../api/models/user';
import { buildMcpServer } from './server';
import { ArchiviumOAuthProvider } from './oauth';

const issuerUrl = new URL(`https://${DOMAIN}`);
const resourceServerUrl = new URL(`https://${DOMAIN}/mcp`);
const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resourceServerUrl);

const provider = new ArchiviumOAuthProvider();

async function resolveUser(req: Request): Promise<User | null> {
  const userId = req.auth?.extra?.userId;
  if (typeof userId !== 'number') return null;
  return api.user.getOne({ 'user.id': userId }).catch(() => null);
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
  app.use((req, res, next) => {
    res.removeHeader('Content-Type');
    next();
  });

  app.use(mcpAuthRouter({
    provider,
    issuerUrl,
    resourceServerUrl,
    resourceName: 'Archivium',
  }));

  const bearerAuth = requireBearerAuth({ verifier: provider, resourceMetadataUrl });

  app.post('/mcp', bearerAuth, async (req, res, next) => {
    const user = await resolveUser(req);
    if (!user) {
      res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized.' }, id: null });
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
    }
    next();
  });

  app.get('/mcp', bearerAuth, methodNotAllowed);
  app.delete('/mcp', bearerAuth, methodNotAllowed);

  logger.info('MCP server mounted at /mcp (OAuth 2.1)');
}

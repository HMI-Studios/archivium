const { defineConfig } = require("cypress");
const crypto = require("crypto");

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

module.exports = defineConfig({
  e2e: {
    baseUrl: 'http://localhost:33004',
    setupNodeEvents(on, config) {
      const db = require('./dist/db');

      on('task', {
        // PKCE requires real SHA-256; generating it here (Node) is simpler than
        // relying on the browser's async Web Crypto API from within a spec.
        makePkce() {
          const verifier = base64url(crypto.randomBytes(32));
          const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
          return { verifier, challenge };
        },

        async deleteOAuthClients(clientIds) {
          for (const clientId of clientIds) {
            await db.query('DELETE FROM oauth_client WHERE client_id = ?', [clientId]);
          }
          return null;
        },
      });
    },
  },
});

const { defineConfig } = require("cypress");
const crypto = require("crypto");

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

module.exports = defineConfig({
  e2e: {
    baseUrl: 'http://localhost:33004',
    setupNodeEvents(on, config) {
      const { kysely } = require('./dist/db/kysely');

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
            await kysely.deleteFrom('oauth_client').where('client_id', '=', clientId).execute();
          }
          return null;
        },

        // Sponsors a universe at premium tier and sets its MCP toggles directly, since
        // no seeded universe is premium. Pass premium: false to undo.
        async setMcpUniverse({ shortname, premium, toggles = {} }) {
          const universe = await kysely.selectFrom('universe').select(['id', 'author_id']).where('shortname', '=', shortname).executeTakeFirstOrThrow();
          await kysely.deleteFrom('usersponsoreduniverse').where('universe_id', '=', universe.id).execute();
          if (premium) {
            await kysely.insertInto('usersponsoreduniverse').values({ universe_id: universe.id, user_id: universe.author_id, tier: 1 }).execute();
          }
          await kysely.updateTable('universe').set({
            mcp_items_enabled: Boolean(toggles.items),
            mcp_notes_enabled: Boolean(toggles.notes),
            mcp_discussions_enabled: Boolean(toggles.discussions),
            mcp_items_write_enabled: Boolean(toggles.itemsWrite),
            mcp_notes_write_enabled: Boolean(toggles.notesWrite),
          }).where('id', '=', universe.id).execute();
          return null;
        },

        async deleteItems({ universe, items }) {
          const u = await kysely.selectFrom('universe').select('id').where('shortname', '=', universe).executeTakeFirst();
          if (u && items.length) {
            await kysely.deleteFrom('item').where('universe_id', '=', u.id).where('shortname', 'in', items).execute();
          }
          return null;
        },

        // OAuth consent requires a verified account; seeded test users aren't verified.
        // Returns the previous { username: verified } states so a spec can restore them.
        async setVerified(states) {
          const prev = {};
          for (const [username, verified] of Object.entries(states)) {
            const row = await kysely.selectFrom('user').select('verified').where('username', '=', username).executeTakeFirstOrThrow();
            prev[username] = Boolean(row.verified);
            await kysely.updateTable('user').set({ verified }).where('username', '=', username).execute();
          }
          return prev;
        },

        async deleteNotes(uuids) {
          if (uuids.length) await kysely.deleteFrom('note').where('uuid', 'in', uuids).execute();
          return null;
        },
      });
    },
  },
});

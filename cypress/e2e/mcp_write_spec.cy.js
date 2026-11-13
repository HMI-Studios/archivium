describe('MCP write access spec', () => {
  const redirectUri = `${Cypress.config().baseUrl}/`;
  const universe = 'public-test-universe';
  const itemShortname = `mcp-write-test-${Date.now()}`;
  const createdNotes = [];
  let client;
  let prevVerified;

  const allWrites = { items: true, notes: true, discussions: true, itemsWrite: true, notesWrite: true };

  before(() => {
    cy.request('POST', '/register', {
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      client_name: 'Cypress MCP Write Client',
    }).then((res) => {
      client = res.body;
    });
    cy.task('setMcpUniverse', { shortname: universe, premium: true, toggles: allWrites });
    cy.task('setVerified', { testwriter: true, testreader: true }).then((prev) => {
      prevVerified = prev;
    });
  });

  after(() => {
    if (prevVerified) cy.task('setVerified', prevVerified);
    cy.task('deleteNotes', createdNotes);
    cy.task('deleteItems', { universe, items: [itemShortname] });
    cy.task('setMcpUniverse', { shortname: universe, premium: false });
    if (client) cy.task('deleteOAuthClients', [client.client_id]);
  });

  function authorizeUrl(challenge) {
    const qs = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: redirectUri,
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'write-spec',
    });
    return `/authorize?${qs}`;
  }

  function grantRow() {
    return cy.get('#mcpGrantTable tbody tr').contains('td', 'Public Test Universe').parent('tr');
  }

  /** Runs the consent flow as `username`, ticking the given write boxes, and returns an access token. */
  function authorize(username, { items = false, notes = false } = {}) {
    let verifier;
    cy.login(username);
    cy.task('makePkce').then((pkce) => {
      verifier = pkce.verifier;
      cy.visit(authorizeUrl(pkce.challenge));
    });
    grantRow().within(() => {
      cy.get('input[name^="items_write_"]').then(($el) => { if ($el.prop('checked') !== items) cy.wrap($el).click(); });
      cy.get('input[name^="notes_write_"]').then(($el) => { if ($el.prop('checked') !== notes) cy.wrap($el).click(); });
    });
    cy.get('button[value="approve"]').click();
    cy.url().should('include', 'code=');
    return cy.url().then((url) => cy.request({
      method: 'POST', url: '/token', form: true,
      body: {
        grant_type: 'authorization_code',
        code: new URL(url).searchParams.get('code'),
        code_verifier: verifier,
        redirect_uri: redirectUri,
        client_id: client.client_id,
      },
    })).then((res) => res.body.access_token);
  }

  function mcp(token, method, params = {}, failOnStatusCode = true) {
    return cy.request({
      method: 'POST', url: '/mcp', failOnStatusCode,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' },
      body: { jsonrpc: '2.0', id: 1, method, params },
    });
  }

  function callTool(token, name, args = {}) {
    return mcp(token, 'tools/call', { name, arguments: args }).then((res) => {
      expect(res.status).to.eq(200);
      return res.body.result;
    });
  }

  function toolNames(token) {
    return mcp(token, 'tools/list').then((res) => res.body.result.tools.map((t) => t.name));
  }

  it('only offers write access where both the universe and the user allow it', () => {
    // testwriter has WRITE on the universe: both capabilities are grantable.
    cy.login('testwriter');
    cy.task('makePkce').then(({ challenge }) => cy.visit(authorizeUrl(challenge)));
    grantRow().find('input[name^="items_write_"]').should('exist').and('not.be.checked');
    grantRow().find('input[name^="notes_write_"]').should('exist').and('not.be.checked');

    // testreader can only read the (public) universe: notes are grantable, items are not.
    cy.login('testreader');
    cy.task('makePkce').then(({ challenge }) => cy.visit(authorizeUrl(challenge)));
    grantRow().find('input[name^="items_write_"]').should('not.exist');
    grantRow().find('input[name^="notes_write_"]').should('exist');

    // When the universe disables writes, nothing is grantable.
    cy.task('setMcpUniverse', { shortname: universe, premium: true, toggles: { items: true, notes: true } });
    cy.login('testwriter');
    cy.task('makePkce').then(({ challenge }) => cy.visit(authorizeUrl(challenge)));
    cy.get('#mcpGrantTable').should('not.exist');
    cy.task('setMcpUniverse', { shortname: universe, premium: true, toggles: allWrites });
  });

  it('a read-only grant does not expose write tools', () => {
    authorize('testwriter').then((token) => {
      toolNames(token).then((names) => {
        expect(names).to.have.length(6);
        expect(names).not.to.include('create_item');
      });
      callTool(token, 'list_universes').then((result) => {
        const u = JSON.parse(result.content[0].text).find((x) => x.shortname === universe);
        expect(u.writable).to.deep.eq({ items: false, notes: false });
        expect(u.item_types).to.have.property('article');
      });
    });
  });

  it('creates and edits items and notes within the granted universe', () => {
    authorize('testwriter', { items: true, notes: true }).then((token) => {
      toolNames(token).then((names) => {
        expect(names).to.include.members(['create_item', 'update_item', 'create_item_note', 'update_item_note']);
      });

      callTool(token, 'create_item', {
        universe_shortname: universe,
        title: 'MCP Write Test',
        shortname: itemShortname,
        item_type: 'article',
        body_html: '<h2>Origins</h2><p>Allied with <a href="@test-article">the article</a>.</p>',
        tags: ['mcp'],
      }).then((result) => expect(result.isError).to.not.eq(true));

      callTool(token, 'update_item', {
        universe_shortname: universe,
        item_shortname: itemShortname,
        append_html: '<p>Appended paragraph.</p>',
      }).then((result) => expect(result.isError).to.not.eq(true));

      callTool(token, 'get_item', { universe_shortname: universe, item_shortname: itemShortname, format: 'html' }).then((result) => {
        const item = JSON.parse(result.content[0].text);
        expect(item.title).to.eq('MCP Write Test');
        expect(item.tags).to.deep.eq(['mcp']);
        expect(item.body).to.include('Origins');
        expect(item.body).to.include('@test-article');
        expect(item.body).to.include('Appended paragraph.');
      });

      // update_item refuses ambiguous body changes
      callTool(token, 'update_item', {
        universe_shortname: universe, item_shortname: itemShortname, body_html: '<p>x</p>', append_html: '<p>y</p>',
      }).then((result) => expect(result.isError).to.eq(true));

      callTool(token, 'create_item_note', {
        universe_shortname: universe,
        item_shortname: itemShortname,
        title: 'MCP Note',
        body_html: '<p>A note.</p>',
        is_public: true,
      }).then((result) => {
        const { uuid } = JSON.parse(result.content[0].text);
        createdNotes.push(uuid);

        callTool(token, 'update_item_note', {
          universe_shortname: universe, item_shortname: itemShortname, note_uuid: uuid, title: 'MCP Note (edited)',
        }).then((res) => expect(res.isError).to.not.eq(true));

        // A note can only be edited via an item it is actually attached to.
        callTool(token, 'update_item_note', {
          universe_shortname: universe, item_shortname: 'test-article', note_uuid: uuid, title: 'nope',
        }).then((res) => expect(res.isError).to.eq(true));

        callTool(token, 'list_item_notes', { universe_shortname: universe, item_shortname: itemShortname }).then((res) => {
          const notes = JSON.parse(res.content[0].text);
          const note = notes.find((n) => n.uuid === uuid);
          expect(note.title).to.eq('MCP Note (edited)');
          expect(note.is_mine).to.eq(true);
        });
      });
    });
  });

  it('refuses writes once the universe disables them, even with a grant', () => {
    authorize('testwriter', { items: true, notes: true }).then((token) => {
      cy.task('setMcpUniverse', { shortname: universe, premium: true, toggles: { items: true, notes: true } });
      callTool(token, 'update_item', {
        universe_shortname: universe, item_shortname: itemShortname, title: 'Should not change',
      }).then((result) => {
        expect(result.isError).to.eq(true);
        expect(result.content[0].text).to.include('not enabled');
      });
      cy.task('setMcpUniverse', { shortname: universe, premium: true, toggles: allWrites });
    });
  });

  it('lets the user change and revoke the grant from settings, taking effect immediately', () => {
    authorize('testwriter', { items: true }).then((token) => {
      toolNames(token).should('include', 'create_item');

      cy.visit('/settings?tab=connected-apps');
      cy.contains('h3', 'Cypress MCP Write Client').parent().within(() => {
        cy.contains('td', 'Public Test Universe').parent('tr').find('input[name^="items_write_"]').should('be.checked').click();
        cy.contains('button', 'Save Permissions').click();
      });
      toolNames(token).should('not.include', 'create_item');

      cy.visit('/settings?tab=connected-apps');
      cy.contains('h3', 'Cypress MCP Write Client').parent().within(() => {
        cy.contains('button', 'Disconnect').click();
      });
      cy.contains('h3', 'Cypress MCP Write Client').should('not.exist');
      mcp(token, 'tools/list', {}, false).its('status').should('eq', 401);
    });
  });
});

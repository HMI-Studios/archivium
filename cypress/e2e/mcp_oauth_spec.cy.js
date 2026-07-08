describe('MCP OAuth spec', () => {
  const redirectUri = `${Cypress.config().baseUrl}/`;
  let publicClient;
  let confClient;

  before(() => {
    cy.request('POST', '/register', {
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      client_name: 'Cypress Public Client',
    }).then((res) => {
      expect(res.status).to.eq(201);
      expect(res.body.client_id).to.be.a('string');
      expect(res.body.client_secret).to.be.undefined;
      publicClient = res.body;
    });

    cy.request('POST', '/register', {
      redirect_uris: [redirectUri],
      client_name: 'Cypress Confidential Client',
    }).then((res) => {
      expect(res.status).to.eq(201);
      expect(res.body.client_id).to.be.a('string');
      expect(res.body.client_secret).to.be.a('string');
      confClient = res.body;
    });
  });

  after(() => {
    const ids = [publicClient?.client_id, confClient?.client_id].filter(Boolean);
    if (ids.length) cy.task('deleteOAuthClients', ids);
  });

  function authorizeUrl(clientId, challenge, state) {
    const qs = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    });
    return `/authorize?${qs}`;
  }

  it('redirects an unauthenticated user to log in before showing consent', () => {
    cy.logout();
    cy.task('makePkce').then(({ challenge }) => {
      cy.visit(authorizeUrl(publicClient.client_id, challenge, 'unauth-check'));
      return cy.url().should('include', '/login');
    });
  });

  it('shows a consent screen with the correct hidden fields once logged in', () => {
    cy.login('testadmin');
    cy.task('makePkce').then(({ challenge }) => {
      cy.visit(authorizeUrl(publicClient.client_id, challenge, 'consent-check'));
      cy.contains('Cypress Public Client').should('exist');
      cy.get('input[name="client_id"]').should('have.value', publicClient.client_id);
      cy.get('input[name="redirect_uri"]').should('have.value', redirectUri);
      cy.get('input[name="code_challenge"]').should('have.value', challenge);
      cy.get('button[value="approve"]').should('exist');
      return cy.get('button[value="deny"]').should('exist');
    });
  });

  it('denying the request redirects back with an access_denied error', () => {
    cy.login('testadmin');
    cy.task('makePkce').then(({ challenge }) => {
      cy.visit(authorizeUrl(publicClient.client_id, challenge, 'deny-check'));
      return cy.get('button[value="deny"]').click();
    });
    cy.url().should('include', 'error=access_denied');
    cy.url().should('include', 'state=deny-check');
  });

  it('completes the public-client authorization_code + PKCE flow end to end', () => {
    let verifier, code, accessToken, refreshToken, newAccessToken;

    cy.login('testadmin');
    cy.task('makePkce').then((pkce) => {
      verifier = pkce.verifier;
      cy.visit(authorizeUrl(publicClient.client_id, pkce.challenge, 'approve-check'));
      return cy.get('button[value="approve"]').click();
    });

    cy.url().should('include', 'code=').should('include', 'state=approve-check');
    cy.url().then((url) => {
      code = new URL(url).searchParams.get('code');
    });

    // wrong verifier is rejected
    cy.then(() => cy.request({
      method: 'POST', url: '/token', form: true, failOnStatusCode: false,
      body: { grant_type: 'authorization_code', code, code_verifier: 'not-the-real-verifier', redirect_uri: redirectUri, client_id: publicClient.client_id },
    })).then((res) => {
      expect(res.status).to.eq(400);
      expect(res.body.error).to.eq('invalid_grant');
    });

    // correct verifier succeeds
    cy.then(() => cy.request({
      method: 'POST', url: '/token', form: true,
      body: { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri, client_id: publicClient.client_id },
    })).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.access_token).to.be.a('string');
      expect(res.body.refresh_token).to.be.a('string');
      accessToken = res.body.access_token;
      refreshToken = res.body.refresh_token;
    });

    // the code is single-use
    cy.then(() => cy.request({
      method: 'POST', url: '/token', form: true, failOnStatusCode: false,
      body: { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri, client_id: publicClient.client_id },
    })).then((res) => {
      expect(res.status).to.eq(400);
      expect(res.body.error).to.eq('invalid_grant');
    });

    // the access token authorizes real MCP requests
    cy.then(() => cy.request({
      method: 'POST', url: '/mcp',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json, text/event-stream' },
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    })).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.result.tools).to.have.length(6);
    });

    cy.then(() => cy.request({
      method: 'POST', url: '/mcp',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json, text/event-stream' },
      body: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_universes', arguments: {} } },
    })).then((res) => {
      expect(res.status).to.eq(200);
      const universes = JSON.parse(res.body.result.content[0].text);
      expect(universes).to.be.an('array');
    });

    // an invalid bearer token is rejected with a spec-compliant WWW-Authenticate header
    cy.request({
      method: 'POST', url: '/mcp', failOnStatusCode: false,
      headers: { Authorization: 'Bearer not-a-real-token', Accept: 'application/json, text/event-stream' },
      body: { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
    }).then((res) => {
      expect(res.status).to.eq(401);
      expect(res.headers['www-authenticate']).to.include('resource_metadata');
    });

    // refresh tokens rotate on use
    cy.then(() => cy.request({
      method: 'POST', url: '/token', form: true,
      body: { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: publicClient.client_id },
    })).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.access_token).to.be.a('string').and.not.eq(accessToken);
      newAccessToken = res.body.access_token;
    });

    cy.then(() => cy.request({
      method: 'POST', url: '/token', form: true, failOnStatusCode: false,
      body: { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: publicClient.client_id },
    })).then((res) => {
      expect(res.status).to.eq(400);
      expect(res.body.error).to.eq('invalid_grant');
    });

    // revoking a token immediately invalidates it
    cy.then(() => cy.request({
      method: 'POST', url: '/revoke', form: true,
      body: { token: newAccessToken, client_id: publicClient.client_id },
    })).then((res) => {
      expect(res.status).to.eq(200);
    });

    cy.then(() => cy.request({
      method: 'POST', url: '/mcp', failOnStatusCode: false,
      headers: { Authorization: `Bearer ${newAccessToken}`, Accept: 'application/json, text/event-stream' },
      body: { jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} },
    })).then((res) => {
      expect(res.status).to.eq(401);
    });
  });

  it('requires a client_secret for the confidential client at the token endpoint', () => {
    let verifier, code;

    cy.login('testadmin');
    cy.task('makePkce').then((pkce) => {
      verifier = pkce.verifier;
      cy.visit(authorizeUrl(confClient.client_id, pkce.challenge, 'conf-check'));
      return cy.get('button[value="approve"]').click();
    });
    cy.url().then((url) => {
      code = new URL(url).searchParams.get('code');
    });

    cy.then(() => cy.request({
      method: 'POST', url: '/token', form: true, failOnStatusCode: false,
      body: { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri, client_id: confClient.client_id },
    })).then((res) => {
      expect(res.status).to.eq(400);
      expect(res.body.error).to.eq('invalid_client');
    });

    cy.then(() => cy.request({
      method: 'POST', url: '/token', form: true,
      body: { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri, client_id: confClient.client_id, client_secret: confClient.client_secret },
    })).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.access_token).to.be.a('string');
    });
  });

  it('advertises OAuth discovery metadata', () => {
    cy.request('/.well-known/oauth-authorization-server').then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.authorization_endpoint).to.match(/\/authorize$/);
      expect(res.body.token_endpoint).to.match(/\/token$/);
      expect(res.body.registration_endpoint).to.match(/\/register$/);
    });

    cy.request('/.well-known/oauth-protected-resource/mcp').then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.authorization_servers).to.be.an('array').that.is.not.empty;
    });
  });
});

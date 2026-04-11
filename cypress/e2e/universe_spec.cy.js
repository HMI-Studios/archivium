describe('Universe spec', () => {
  beforeEach(() => {
    cy.login('testadmin');
  });

  it('tries to create duplicate universe, sees error messsage', () => {
    cy.visit('/universes/create');

    cy.get('#title').type('Duplicate Test Universe');
    cy.get('#shortname').clear().type('public-test-universe');
    cy.get('button[type="submit"]').click();
    cy.get('.color-error').contains('Universe shortname must be unique.').should('exist');
  });

  it('edits the public universe title and types', () => {
    cy.visit('/universes/public-test-universe');

    cy.get('#action-bar').contains('Edit').click();

    cy.get('#title').clear().type('Alternate Title');

    // Remove all 9 item types
    for (let i = 0; i < 9; i++) {
      cy.get('#cats button').contains('Remove').click();
    }

    cy.get('#save-btn').click();

    // Confirm that title has been changed and that all item types have been removed
    cy.get('h1').contains('Private Test Universe').should('not.exist');
    cy.get('h1').contains('Alternate Title').should('exist');
    cy.get('.tabs [data-tab=items]').should('have.text', 'No item types have been defined yet — go to the edit page to add some.');

    cy.get('#action-bar').contains('Edit').click();

    // Add a new item type
    cy.contains('Add Type').click();
    cy.get('#cats tr').last().as('newType');
    cy.get('@newType').find('[data-name=title]').type('test');
    cy.get('@newType').find('[data-name=titlePl]').should('have.value', 'tests');
    cy.get('#save-btn').click();

    // Confirm that the new type exists
    cy.get('.item-type a').contains('Tests').should('exist');
  });

  it('restores the original title and types for the public universe', () => {
    cy.visit('/universes/public-test-universe');

    cy.get('#action-bar').contains('Edit').click();

    cy.get('#title').clear().type('Public Test Universe');
    cy.contains('Reset to default types').click();

    cy.get('#save-btn').click();
  });

  it('demotes and then restores an author of the public universe', () => {
    cy.visit('/universes/public-test-universe');
    cy.get('#action-bar').contains('Admin Menu').click();

    cy.get('form').contains('testwriter').parent().find('select').select('1');
    cy.get('#breadcrumbs').contains('Public Test Universe').click();

    cy.get('#tabBtns').contains('Authors').click();
    cy.get('.tabs [data-tab=authors] .card').contains('testwriter').should('not.exist');

    cy.get('#action-bar').contains('Admin Menu').click();

    cy.get('form').contains('testwriter').parent().find('select').select('3');
    cy.get('#breadcrumbs').contains('Public Test Universe').click();

    cy.get('#tabBtns').contains('Authors').click();
    cy.get('.tabs [data-tab=authors] .card').contains('testwriter').should('exist');
  });

  it('removes and then reinvites an author of the private universe', () => {
    cy.visit('/universes/private-test-universe');
    cy.get('#action-bar').contains('Admin Menu').click();

    cy.intercept('PUT', '/api/universes/private-test-universe/perms').as('setperms');
    cy.get('form').contains('testwriter').parent().find('select').select('0');
    cy.wait('@setperms');
    cy.get('#breadcrumbs').contains('Private Test Universe').click();

    cy.get('#tabBtns').contains('Authors').click();
    cy.get('.tabs [data-tab=authors] .card').contains('testwriter').should('not.exist');

    cy.get('#tabBtns').contains('Viewers').click();
    cy.get('.tabs [data-tab=viewers] .card').contains('testwriter').should('not.exist');

    cy.visit('/universes/private-test-universe');
    cy.get('#action-bar').contains('Admin Menu').click();

    cy.get('#invite_user').parent().find('#username').type('testwriter');
    cy.get('#new_permission_level').select('3');
    cy.get('#invite_user').click();

    cy.login('testwriter');
    cy.visit('/universes/private-test-universe');
    cy.get('button').contains('Accept').click();

    cy.login('testadmin');
    cy.visit('/universes/private-test-universe');
    cy.get('#tabBtns').contains('Authors').click();
    cy.get('.tabs [data-tab=authors] .card').contains('testwriter').should('exist');
  });

  it('creates new private universe with a public page', () => {
    cy.visit('/universes');
    cy.get('a').contains('New Universe').click();

    cy.get('h2').contains('New Universe').should('exist');

    cy.get('#title').type('Cypress Universe');
    cy.get('#shortname').should('have.value', 'cypress-universe');
    cy.get('#visibility').select('private');
    cy.get('#discussion_enabled').select('disabled');
    cy.get('#discussion_open').select('disabled');

    cy.get('button[type="submit"]').click();

    cy.get('h1').contains('Cypress Universe').should('exist');
    cy.get('#action-bar').contains('Edit').click();
    cy.get('#public-body .switch').click();
    cy.intercept('GET', '/api/universes/cypress-universe/items/_public').as('request');
    cy.get('#public-body button').click();
    cy.wait('@request');

    cy.get('#add-tab').click();
    cy.get('.modal select').select('Main Text');
    cy.get('.modal button').contains('New Tab').click();

    cy.get('.tiptap-editor .tiptap').should('be.visible');
    cy.get('.tiptap-editor .tiptap').type('This is the public page for the Cypress Universe.');

    cy.get('#preview-btn').click();
  });

  it('requests access to new universe as reader, admin approves', () => {
    cy.login('testreader');
    cy.visit('/universes/cypress-universe');
    cy.get('button').contains('Request Access').click();

    cy.login('testadmin');
    cy.visit('/universes/cypress-universe');
    cy.get('#action-bar').contains('Admin Menu').click();

    cy.get('#requests').contains('testreader is requesting read permissions').parent().contains('Approve').click();

    cy.get('#breadcrumbs').contains('Cypress Universe').click();
    cy.get('#tabBtns').contains('Viewers').click();
    cy.get('.tabs [data-tab=viewers] .card').contains('testreader').should('exist');
  });

  it('checks the universe list as test reader, sees the universe', () => {
    cy.login('testreader');
    cy.visit('/universes');
    cy.get('.card-list .card h3').contains('Cypress Universe').should('exist');
  });

  it('requests write access as reader, admin approves', () => {
    cy.login('testreader');
    cy.visit('/universes/cypress-universe');
    cy.get('#tabBtns').contains('Authors').click();
    cy.get('[data-tab=authors]').contains('Request Write Access').click();

    cy.login('testadmin');
    cy.visit('/universes/cypress-universe');
    cy.get('#action-bar').contains('Admin Menu').click();

    cy.get('#requests').contains('testreader is requesting write permissions').parent().contains('Approve').click();

    cy.get('#breadcrumbs').contains('Cypress Universe').click();
    cy.get('#tabBtns').contains('Authors').click();
    cy.get('.tabs [data-tab=authors] .card').contains('testreader').should('exist');
  });

  it('removes the reader\'s permissions, the reader can no longer see the universe', () => {
    cy.visit('/universes/cypress-universe');
    cy.get('#action-bar').contains('Admin Menu').click();

    cy.intercept('PUT', '/api/universes/cypress-universe/perms').as('setperms');
    cy.get('form').contains('testreader').parent().find('select').select('0');
    cy.wait('@setperms');

    cy.login('testreader');
    cy.visit('/universes');
    cy.get('.card-list .card h3').contains('Cypress Universe').should('not.exist');
  });

  it('anonymous users cannot see the private universe, but can see the public page', () => {
    cy.logout();
    cy.visit('/universes');
    cy.get('.card-list .card h3').contains('Cypress Universe').should('not.exist');

    cy.visit('/universes/cypress-universe');
    cy.get('.page .markdown').should('have.text', 'This is the public page for the Cypress Universe.');

  });

  it('makes the universe public, the reader can see the universe again', () => {
    cy.visit('/universes/cypress-universe');
    cy.get('#action-bar').contains('Edit').click();

    cy.get('#visibility').select('public');
    cy.get('#save-btn').click();

    cy.login('testreader');
    cy.visit('/universes');
    cy.get('.card-list .card h3').contains('Cypress Universe').should('exist');
  });

  it('anonymous users can see the now public universe', () => {
    cy.logout();
    cy.visit('/universes');
    cy.get('.card-list .card h3').contains('Cypress Universe').should('exist');
  });

  it('deletes the new universe', () => {
    cy.visit('/universes/cypress-universe');

    cy.get('h1').contains('Cypress Universe').should('exist');
    cy.get('#action-bar').contains('Delete').click();

    cy.get('#shortname').clear().type('cypress-universe');
    cy.get('button').contains('Delete Universe').click();

    cy.url().should('eq', Cypress.config().baseUrl + '/universes');

    cy.get('.card-list .card h3').contains('Cypress Universe').should('not.exist');
  });
});

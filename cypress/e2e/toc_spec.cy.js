describe('Nested table of contents spec', () => {
  beforeEach(() => {
    cy.login('testadmin');
  });

  it('creates a new item for testing nested tables of contents', () => {
    cy.visit('/universes/public-test-universe/items/create');

    cy.get('#title').type('Cypress Toc Test');
    cy.get('#shortname').should('have.value', 'cypress-toc-test');

    cy.get('button[type="submit"]').click();
  });

  it('builds nested headings and tables of contents, and sees correct scoping live and after saving', () => {
    cy.intercept('GET', '/api/universes/public-test-universe/items/cypress-toc-test').as('request');
    cy.visit('/editor/universes/public-test-universe/items/cypress-toc-test');
    cy.wait('@request');

    // The item starts with no tabs; add a "Main Text" (body) tab before we can use the editor.
    cy.contains('h3.navbarBtnLink', 'add').click();
    cy.get('.modal-content select').select('Main Text');
    cy.get('.modal-content button').contains('New Tab').click();

    cy.get('.tiptap-editor .tiptap').should('be.visible').click();
    cy.get('.tiptap-editor .tiptap').type(
      '@toc{enter}' +
      '# Section One{enter}' +
      '@toc{enter}' +
      '## Sub A{enter}' +
      '### Detail{enter}' +
      '## Sub B{enter}' +
      '# Section Two'
    );
    cy.wait(600);

    // The top-level toc (no enclosing heading) sees the whole document's outline.
    cy.get('.tiptap-editor .toc').eq(0)
      .should('contain', 'Section One')
      .and('contain', 'Sub A')
      .and('contain', 'Detail')
      .and('contain', 'Sub B')
      .and('contain', 'Section Two');

    // The toc nested right under "Section One" only sees that heading's own subheadings.
    cy.get('.tiptap-editor .toc').eq(1)
      .should('contain', 'Sub A')
      .and('contain', 'Detail')
      .and('contain', 'Sub B')
      .and('not.contain', 'Section One')
      .and('not.contain', 'Section Two');

    // Editing a heading's text updates both tocs live, with no save/reload.
    cy.get('.tiptap-editor h2').contains('Sub A').click().type('{end} Renamed');
    cy.wait(500);
    cy.get('.tiptap-editor .toc').eq(0).should('contain', 'Sub A Renamed');
    cy.get('.tiptap-editor .toc').eq(1).should('contain', 'Sub A Renamed');

    // Persist, then confirm the same scoping holds in the read view.
    cy.get('#preview-btn').click();

    cy.get('[data-tab="body"] .toc').eq(0)
      .should('contain', 'Section One')
      .and('contain', 'Sub A Renamed')
      .and('contain', 'Detail')
      .and('contain', 'Sub B')
      .and('contain', 'Section Two');

    cy.get('[data-tab="body"] .toc').eq(1)
      .should('contain', 'Sub A Renamed')
      .and('contain', 'Detail')
      .and('contain', 'Sub B')
      .and('not.contain', 'Section One')
      .and('not.contain', 'Section Two');
  });

  it('logs in as owner, deletes the test item', () => {
    cy.login('testowner');

    cy.visit('/universes/public-test-universe/items/cypress-toc-test');
    cy.get('#action-bar').contains('Delete').click();

    cy.get('#shortname').type('cypress-toc-test');
    cy.get('button').contains('Delete Item').click();
  });
});

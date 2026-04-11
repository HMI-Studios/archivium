describe('Note spec', () => {
  it('visits item, sees that notes tab is disabled and enables it', () => {
    cy.logout();

    cy.visit('/universes/public-test-universe/items/test-article');
    cy.get('#tabBtns [data-tab=notes]').should('not.exist');

    cy.login('testadmin');

    cy.visit('/universes/public-test-universe/items/test-article');
    cy.get('#tabBtns [data-tab=notes]').should('have.text', 'Notes (Hidden)');
    cy.get('#action-bar').contains('Edit').click();

    cy.get('#edit #notes').parent().click();
    cy.get('#preview-btn').click();
  });

  it('note author visits item, sees both item notes', () => {
    cy.login('testwriter');
    cy.visit('/universes/public-test-universe/items/test-article?tab=notes');
    cy.get('#note-list').children('.card').should('have.length', 2);
  });

  it('note author visits notes page, sees all four notes', () => {
    cy.login('testwriter');
    cy.visit('/notes');
    cy.get('#note-list').children('.card').should('have.length', 4);
  });

  it('other user visits item, sees only the public note', () => {
    cy.login('testreader');
    cy.visit('/universes/public-test-universe/items/test-article?tab=notes');
    cy.get('#note-list').children('.card').should('have.length', 1);
    cy.get('#note-list').get('h2').should('have.text', 'Public Article Note');
  });

  it('other user visits notes page, sees no notes', () => {
    cy.login('testreader');
    cy.visit('/notes');
    cy.get('#note-list').children('.card').should('have.length', 0);
  });

  it('links note to an item, sees the note on that item\'s notes page', () => {
    cy.login('testwriter');
    cy.visit('/notes');
    cy.get('#note-list').contains('Public Test Note').parent().find('a').contains('Edit').click();

    cy.get('#note-items input').first().type('Test Character');
    cy.get('.options-container .option').filter(':visible').click();
    cy.intercept('PUT', '/api/users/testwriter/notes/*').as('request');
    cy.get('#save-changes').click();
    cy.wait('@request');
    cy.get('#back-to-list').click();

    cy.get('#note-list').contains('Public Test Note').parents('.card').find('.item-links span').children('a').should('have.length', 1);
    cy.get('#note-list').contains('Public Test Note').parents('.card').find('.item-links span').children('a').contains('Test Character').click();

    cy.get('#tabBtns').contains('Notes (Hidden)').click();
    cy.get('#note-list').children('.card').should('have.length', 1);
    cy.get('#note-list').get('h2').should('have.text', 'Public Test Note');
  });

  it('unlinks the note, no longer sees it on that item\'s notes page', () => {
    cy.login('testwriter');
    cy.visit('/notes');
    cy.get('#note-list').contains('Public Test Note').parent().find('a').contains('Edit').click();

    cy.get('#note-items-edit').contains('Test Character').siblings('a').contains('delete').click();
    cy.intercept('PUT', '/api/users/testwriter/notes/*').as('request');
    cy.get('#save-changes').click();
    cy.wait('@request');
    cy.get('#back-to-list').click();

    cy.get('#note-list').contains('Public Test Note').parents('.card').find('.item-links span').should('not.exist');

    cy.visit('/universes/public-test-universe/items/test-character');
    cy.get('#tabBtns [data-tab=notes]').should('not.exist');
  });

  it('disables notes tab again', () => {
    cy.login('testadmin');

    cy.visit('/universes/public-test-universe/items/test-article');
    cy.get('#tabBtns [data-tab=notes]').should('have.text', 'Notes');
    cy.get('#action-bar').contains('Edit').click();

    cy.get('#edit #notes').parent().click();
    cy.get('#preview-btn').click();

    cy.get('#tabBtns [data-tab=notes]').should('have.text', 'Notes (Hidden)');

    cy.logout();

    cy.visit('/universes/public-test-universe/items/test-article');
    cy.get('#tabBtns [data-tab=notes]').should('not.exist');
  });

  it('adds a tag to the note', () => {
    cy.login('testwriter');
    cy.visit('/notes');
    cy.get('#note-list').contains('Public Test Note').parent().find('a').contains('Edit').click();

    cy.get('#tags').type('cypress ');
    cy.intercept('PUT', '/api/users/testwriter/notes/*').as('request');
    cy.get('#save-changes').click();
    cy.wait('@request');
    cy.get('#back-to-list').click();

    cy.get('#note-list').contains('Public Test Note').parents('.card').find('.tags').should('contain', '#cypress');
  });

  it('tries filtering notes by the tag', () => {
    cy.login('testwriter');
    cy.visit('/notes');
    cy.get('#note-list .tags a').contains('cypress').click();

    cy.get('#note-list').children('.card').filter(':visible').should('have.length', 1);
    cy.get('#note-list').get('h2').filter(':visible').should('have.text', 'Public Test Note');
  });

  it('removes the tag from the note', () => {
    cy.login('testwriter');
    cy.visit('/notes');
    cy.get('#note-list').contains('Public Test Note').parent().find('a').contains('Edit').click();

    cy.get('#tags').siblings('div').children().contains('#cypress').click();
    cy.get('#tags').type('test public ');
    cy.intercept('PUT', '/api/users/testwriter/notes/*').as('request');
    cy.get('#save-changes').click();
    cy.wait('@request');
    cy.get('#back-to-list').click();

    cy.get('#note-list').contains('Public Test Note').parents('.card').find('.tags').should('not.contain', '#cypress');
  });
});

(() => {
  window.addEventListener('load', () => {
    const searchBar = document.querySelector('form>input#search');
    const searchForm = searchBar.parentElement;
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const url = new URL(window.location);
      url.searchParams.set('search', searchBar.value);
      history.pushState(null, '', url);
      location.reload();
    });
  });
})();

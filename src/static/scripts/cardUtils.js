(() => {
  function goTo(href) {
    window.location.href = href;
  }

  window.addEventListener('load', () => {
    document.querySelectorAll('.card[data-goto]').forEach(el => {
      el.addEventListener('click', () => {
        goTo(el.dataset.goto);
      });

      el.querySelectorAll('[href]').forEach(link => {
        link.addEventListener('click', e => e.stopPropagation());
      })
    });
  });
})();

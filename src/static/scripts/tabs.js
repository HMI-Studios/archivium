function showTab(tab) {
  document.querySelectorAll('.tabs [data-tab]').forEach(tab => tab.classList.add('hidden'));
  document.querySelectorAll('.navbarBtn[data-tab]').forEach(btn => btn.classList.remove('selected'));
  document.querySelector(`.tabs [data-tab=${tab}]`)?.classList.remove('hidden');
  document.querySelector(`.navbarBtn[data-tab=${tab}]`)?.classList.add('selected');
  const query = new URLSearchParams(window.location.search);
  query.set('tab', tab);
  const { protocol, host, pathname, hash } = window.location;
  const newurl = `${protocol}//${host}${pathname}?${query.toString()}${hash}`;
  window.history.replaceState(null, '', newurl);
}

const tabLoadPromise = new Promise((resolve) => {
  window.addEventListener('load', () => {
    const query = new URLSearchParams(window.location.search);
    const defaultTab = query.get('tab');

    const tabs = document.getElementById('tabBtns');
    if (tabs.children.length > 0) {
      showTab(defaultTab || tabs.children[0].dataset.tab)
    }

    if (tabs.children.length < 2) {
      tabs.remove();
    }

    resolve();
  });
});

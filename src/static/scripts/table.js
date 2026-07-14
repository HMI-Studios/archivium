function sort(tbody, f, asc=true) {
  const rows = [ ...tbody.children ];
  rows.forEach(row => row.remove());
  rows.sort((a, b) => f(a, b) * (asc ? 1 : -1));
  rows.forEach(row => tbody.appendChild(row));
}

function sortByCol(tbody, col, asc=true, numeric=false) {
  sort(tbody, (...rows) => {
    const [a, b] = rows
      .map(row => row.children[col].dataset.sort)
      .map(value => numeric ? Number(value) : value);
    if (a > b) return 1;
    else if (b > a) return -1;
    else return 0;
  }, asc);
}

window.addEventListener('load', () => {
  document.querySelectorAll('table').forEach((table) => {
    const tbody = table.querySelector('tbody');
    table.querySelectorAll('th').forEach((th, i) => {
      if (th.classList.contains('sortable')) {
        th.onclick = () => {
          sortByCol(tbody, i, table.dataset.sortedCol != i+1, th.classList.contains('sort-numeric'));
          table.dataset.sortedCol = table.dataset.sortedCol != i+1 ? i+1 : `-${i+1}`;
        }
      }
    });
  });
});
let obj_data = {};

function overwriteObjData(newState) {
  obj_data = { ...newState };
  const objDataInput = document.getElementById('obj_data');
  objDataInput.value = encodeURIComponent(JSON.stringify(obj_data));
}

function updateObjData(newState) {
  overwriteObjData({ ...obj_data, ...newState });
}

function setDefaultCats() {
  const defaultCats = [
    ['article', '#deddca'],
    ['character', '#F44336'],
    ['location', '#4CAF50'],
    ['event', '#9e9e9e'],
    ['archive', '#a1887f'],
    ['document', '#4d4d4d'],
    ['timeline', '#64B5F6'],
    ['item', '#ffc107'],
    ['organization', '#9262df'],
  ];
  const cats = {};
  for (const [cat, color] of defaultCats) {
    cats[cat] = [T(cat), T(`${cat}s`), color];
  }
  updateObjData({ cats });
}

async function getJSON(url) {
  return await fetch(url, {
    method: 'GET',
  })
    .then(async (response) => [response, await response.json()]);
}

async function postJSON(url, body) {
  return await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
    .then(response => response.json());
}

async function postFormData(url, data) {
  const formData = new FormData();
  for (const key in data) {
    formData.append(key, data[key]);
  }
  return await fetch(url, {
    method: 'POST',
    body: formData,
  });
}

async function putJSON(url, body) {
  return await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
    .then(async (response) => [response, await response.json()]);
}

async function deleteJSON(url, body) {
  return await fetch(url, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
    .then(async (response) => [response, await response.json()]);
}

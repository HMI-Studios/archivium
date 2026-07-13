async function addContact(username) {
  await fetch('/api/contacts', {
      method: 'POST',
      headers: {
      'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username }),
  });
  window.location.reload();
}

async function respondContact(username, accepted) {
  await fetch('/api/contacts', {
      method: 'PUT',
      headers: {
      'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, accepted }),
  });
  window.location.reload();
}

async function deleteContact(username) {
  await fetch('/api/contacts', {
      method: 'DELETE',
      headers: {
      'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username }),
  });
  window.location.reload();
}

window.addEventListener('load', () => {
  document.querySelectorAll('.contact-accept').forEach((btn) => {
    const username = btn.parentElement.dataset.user;
    btn.onclick = (e) => {
      e.stopPropagation();
      respondContact(username, true);
    }
  });

  document.querySelectorAll('.contact-reject').forEach((btn) => {
    const username = btn.parentElement.dataset.user;
    btn.onclick = (e) => {
      e.stopPropagation();
      respondContact(username, false);
    }
  });

  document.querySelectorAll('.contact-delete').forEach((btn) => {
    const username = btn.parentElement.dataset.user;
    btn.onclick = (e) => {
      e.stopPropagation();
      deleteContact(username);
    }
  });
});
const db = require(".");
const api = require("../api");
const { executeQuery } = require("./legacy");
const { askQuestion } = require("./import");

async function main() {
  await executeQuery('DELETE FROM itemlink');
  const requests = await executeQuery(`
    SELECT user.id, user.username, udr.requested_at
    FROM userdeleterequest AS udr
    INNER JOIN user ON user.id = udr.user_id
    ORDER BY udr.requested_at
  `);
  if (requests.length === 0) {
    console.log('There are no pending delete requests at this time.');
    return;
  }
  console.log(`There are ${requests.length} active deletion requests:`);
  for (const { id, username, requested_at } of requests) {
    console.log(`  (${id}) ${username} - ${requested_at}`);
  }
  const answer = await askQuestion('Enter the ID of the user to delete: ');
  const id = Number(answer);
  if (id.toString() !== answer) {
    console.error('Invalid ID, exiting.');
    return;
  }
  let user;
  try {
    user = await api.user.getOne({ 'user.id': id });
  } catch {
    console.error('No such user, exiting.');
    return;
  }
  const ans = await askQuestion(`This will PERMANENTLY DELETE ${user.username}'s account! Are you SURE? [y/N] `);
  if (ans.toUpperCase() === 'Y') {
    await api.user.doDeleteUser(user.id);
    console.log(`User ${user.username} deleted.`)
  } else {
    const ans = await askQuestion(`Would you instead like to cancel this delete request? [y/N] `);
    if (ans.toUpperCase() === 'Y') {
      await executeQuery('DELETE FROM userdeleterequest WHERE user_id = ?', [user.id]);
      console.log(`Delete request for ${user.username} cancelled.`)
    } else {
      console.log('Aborting.');
    }
  }
}

if (require.main === module) {
  main().then(() => {
    db.end();
  });
}

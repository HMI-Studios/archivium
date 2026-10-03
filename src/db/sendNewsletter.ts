import db from '.';
import readline from 'readline';
import api from '../api';
import { kysely } from '../db/kysely';
import { askQuestion } from './import';
import { handleAsNull } from '../api/utils';
import { ForbiddenError, UnauthorizedError } from '../errors';

async function main() {
  console.log('Please input newletter info below:');
  const shortname = await askQuestion('Newsletter shortname: ');
  const preview = await askQuestion('Preview: ');
  console.log(`Shortname: ${shortname}`);
  console.log(`Preview: ${preview}`);
  const ans = await askQuestion('Does this look right? [y/N] ');
  if (ans.toUpperCase() === 'N') {
    const ans = await askQuestion('Try again? [y/N] ');
    if (ans.toUpperCase() === 'Y') {
      await main();
    } else {
      console.log('Exiting.');
    }
    return;
  }

  const users = await kysely.selectFrom('user').select(['id', 'email', 'email_notifications']).execute();
  const proceed = await askQuestion(`${users.length} users to send to, proceed? [y/N] `);
  if (proceed.toUpperCase() === 'N') {
    console.log('Exiting.');
    return;
  }

  const newsletter = await api.item.getByUniverseAndItemShortnames(undefined, 'archivium', shortname).catch(handleAsNull([UnauthorizedError, ForbiddenError]));
  if (!newsletter) {
    console.log('Newsletter not found or env is badly configured, exiting.');
    return;
  }

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    console.log(`Sending... (${i}/${users.length})`);
    await api.notification.notify(user, api.notification.types.FEATURES, {
      title: newsletter.title,
      body: preview,
      clickUrl: `/news/${shortname}`,
    });
    readline.moveCursor(process.stdout, 0, -1);
  }
  console.log(`Sending... (${users.length}/${users.length})`);
}

if (require.main === module) {
  main().then(() => db.end());
}

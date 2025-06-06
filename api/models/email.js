const { MailerSend, EmailParams, Recipient, Sender } = require('mailersend');
const { DOMAIN, ADDR_PREFIX, DEV_MODE, MAILERSEND_API_KEY } = require('../../config');
const logger = require('../../logger');
const { executeQuery } = require('../utils');
const fs = require('fs');
const path = require('path');
const mjml = require('mjml');
const Handlebars = require('handlebars');

let api;
function setApi(_api) {
  api = _api;
}

const templates = {
  VERIFY: ['confirm', 'verify', 'Account Verification'],
  NOTIFY: ['notification', 'notify', 'Notification'],
  DELETE: ['delete', 'delete', 'User Delete Request'],
  RESET:  ['passwordReset', 'reset', 'Password Reset'],
};

const mailerSend = new MailerSend({
  apiKey: MAILERSEND_API_KEY,
});

const renderTemplate = (templateName, data) => {
  const templatePath = path.join(__dirname, '../../mjml', `${templateName}.mjml`);
  const mjmlRaw = fs.readFileSync(templatePath, 'utf-8');
  const mjmlPopulated = Handlebars.compile(mjmlRaw)(data);
  const html = mjml(mjmlPopulated, { minify: true }).html;
  return html;
};

async function sendEmail(topic, toList, options) {
  const { from, fromName, subject, text, template, templateData } = options;
  const html = template && renderTemplate(template, templateData);
  logger.info(`Sending email to ${toList.join(', ')}...`);
  if (DEV_MODE) {
    logger.warn('Email sending may be disabled in test env.');
  }
  try {
    const emailParams = new EmailParams()
      .setFrom(new Sender(from ?? 'contact@archivium.net', fromName ?? 'Archivium Team'))
      .setTo(toList.map(to => new Recipient(to)))
      .setSubject(subject);
      
    if (text) emailParams.setText(text);
    if (html) emailParams.setHtml(html);

    try {
      await mailerSend.email.send(emailParams);
    } catch (error) {
      if (error.body) {
        logger.error(JSON.stringify(error.body));
      }
    }
    logger.info('Email sent!');
    for (const to of toList) {
      await executeQuery('INSERT INTO sentemail (recipient, topic, sent_at) VALUES (?, ?, ?);', [to, topic, new Date()]);
    }
  } catch (error) {
    logger.error(error);
  }
}

async function sendTemplateEmail([template, topic, subject], to, templateData, options={}) {
  if (!(to instanceof Array)) to = [to];
  await sendEmail(topic, to, {
    subject,
    ...options,
    template,
    templateData,
  });
}

async function sendVerifyLink({ id, username, email }) {
  const verificationKey = await api.user.prepareVerification(id);
  if (DEV_MODE) {
    // Can't send emails in dev mode, just auto-verify them instead.
    await api.user.verifyUser(verificationKey);
    return true;
  }
  
  const verifyEmailLink = `https://${DOMAIN}${ADDR_PREFIX}/verify/${verificationKey}`;
  await sendTemplateEmail(templates.VERIFY, email, { username, verifyEmailLink });
  return false;
}

async function trySendVerifyLink(sessionUser, username) {
  if (!sessionUser) return [401];
  if (sessionUser.username != username) return [403];
  if (sessionUser.verified) return [200, { alreadyVerified: true }];

  const now = new Date();
  const timeout = 60 * 1000;
  const cutoff = new Date(now.getTime() - timeout);
  const recentEmails = await executeQuery(
    'SELECT * FROM sentemail WHERE recipient = ? AND topic = ? AND sent_at >= ? ORDER BY sent_at DESC;',
    [sessionUser.email, 'verify', cutoff],
  );
  if (recentEmails.length > 0) return [429, new Date(recentEmails[0].sent_at.getTime() + timeout)];

  const alreadyVerified = await sendVerifyLink(sessionUser);

  return [200, { alreadyVerified }];
}

async function sendPasswordReset({ id, username, email }) {
  const resetKey = await api.user.preparePasswordReset(id);
  
  const resetPasswordLink = `https://${DOMAIN}${ADDR_PREFIX}/reset-password/${resetKey}`;
  await sendTemplateEmail(templates.RESET, email, { username, resetPasswordLink });
}

async function trySendPasswordReset(user) {
  const now = new Date();
  const timeout = 60 * 1000;
  const cutoff = new Date(now.getTime() - timeout);
  const recentEmails = await executeQuery(
    'SELECT * FROM sentemail WHERE recipient = ? AND topic = ? AND sent_at >= ? ORDER BY sent_at DESC;',
    [user.email, 'reset', cutoff],
  );
  if (recentEmails.length > 0) return [429, new Date(recentEmails[0].sent_at.getTime() + timeout)];

  await sendPasswordReset(user);

  return [200];
}

module.exports = {
  setApi,
  templates,
  sendEmail,
  sendTemplateEmail,
  sendVerifyLink,
  trySendVerifyLink,
  sendPasswordReset,
  trySendPasswordReset,
};

import { MailerSend, EmailParams, Recipient, Sender } from 'mailersend';
import { DOMAIN, DEV_MODE, MAILERSEND_API_KEY } from '../../config';
import logger from '../../logger';
import { kysely } from '../../db/kysely';
import fs from 'fs';
import path from 'path';
import mjml from 'mjml';
import Handlebars from 'handlebars';
import { API } from '..';
import { User } from './user';
import { ForbiddenError, RateLimitError, UnauthorizedError, ValidationError } from '../../errors';

const renderTemplate = (templateName, data) => {
  const templatePath = path.join(__dirname, '../../mjml', `${templateName}.mjml`);
  const mjmlRaw = fs.readFileSync(templatePath, 'utf-8');
  const mjmlPopulated = Handlebars.compile(mjmlRaw)(data);
  const html = mjml(mjmlPopulated, { minify: true }).html;
  return html;
};

export class EmailAPI {
  readonly api: API;
  readonly mailerSend?: MailerSend;
  readonly templates: { [key: string]: [string, string, string] } = {
    VERIFY: ['confirm', 'verify', 'Account Verification'],
    NOTIFY: ['notification', 'notify', 'Notification'],
    DELETE: ['delete', 'delete', 'User Delete Request'],
    RESET:  ['passwordReset', 'reset', 'Password Reset'],
  } as const;

  constructor(api: API) {
    this.api = api;
    if (MAILERSEND_API_KEY) {
      this.mailerSend = new MailerSend({
        apiKey: MAILERSEND_API_KEY,
      });
    }
  }

  private async _send(params: EmailParams) {
    if (!this.mailerSend) throw new Error('Email sending disabled!');
    await this.mailerSend.email.send(params);
  }

  async sendEmail(topic, toList, options) {
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
        await this._send(emailParams);
      } catch (error) {
        if (error.body) {
          logger.error(JSON.stringify(error.body));
        }
      }
      logger.info('Email sent!');
      for (const to of toList) {
        await kysely.insertInto('sentemail').values({ recipient: to, topic, sent_at: new Date() }).execute();
      }
    } catch (error) {
      logger.error(error);
    }
  }

  async sendTemplateEmail([template, topic, subject], to, templateData, options={}) {
    if (!(to instanceof Array)) to = [to];
    await this.sendEmail(topic, to, {
      subject,
      ...options,
      template,
      templateData,
    });
  }

  async sendVerifyLink({ id, username, email }: { id: number, username: string, email?: string }) {
    if (!email) email = await this.api.user.getOne({ id }).then(user => user.email);
    if (!email) throw new ValidationError('Error not provided and couldn\'t be fetched.');
    const verificationKey = await this.api.user.prepareVerification(id);
    if (DEV_MODE) {
      // Can't send emails in dev mode, just auto-verify them instead.
      await this.api.user.verifyUser(verificationKey);
      return true;
    }
    
    const verifyEmailLink = `https://${DOMAIN}/verify/${verificationKey}`;
    await this.sendTemplateEmail(this.templates.VERIFY, email, { username, verifyEmailLink });
    return false;
  }

  async trySendVerifyLink(sessionUser: User | undefined, username: string): Promise<{ alreadyVerified: boolean }> {
    if (!sessionUser) throw new UnauthorizedError();
    if (sessionUser.username != username) throw new ForbiddenError();
    if (sessionUser.verified) return { alreadyVerified: true };
    if (!sessionUser.email) throw new ValidationError();

    const now = new Date();
    const timeout = 60 * 1000;
    const cutoff = new Date(now.getTime() - timeout);
    const recentEmails = await kysely
      .selectFrom('sentemail')
      .selectAll()
      .where('recipient', '=', sessionUser.email)
      .where('topic', '=', 'verify')
      .where('sent_at', '>=', cutoff)
      .orderBy('sent_at', 'desc')
      .execute();
    if (recentEmails.length > 0) throw new RateLimitError(new Date(recentEmails[0].sent_at.getTime() + timeout));

    const alreadyVerified = await this.sendVerifyLink(sessionUser);

    return { alreadyVerified };
  }

  async sendPasswordReset({ id, username, email }) {
    const resetKey = await this.api.user.preparePasswordReset(id);
    
    const resetPasswordLink = `https://${DOMAIN}/reset-password/${resetKey}`;
    await this.sendTemplateEmail(this.templates.RESET, email, { username, resetPasswordLink });
  }

  async trySendPasswordReset(user: User): Promise<void> {
    if (!user.email) throw new ValidationError('Email not provided.');

    const now = new Date();
    const timeout = 60 * 1000;
    const cutoff = new Date(now.getTime() - timeout);
    const recentEmails = await kysely
      .selectFrom('sentemail')
      .selectAll()
      .where('recipient', '=', user.email)
      .where('topic', '=', 'reset')
      .where('sent_at', '>=', cutoff)
      .orderBy('sent_at', 'desc')
      .execute();
    if (recentEmails.length > 0) throw new RateLimitError(new Date(recentEmails[0].sent_at.getTime() + timeout));

    const { id, username, email } = user;
    await this.sendPasswordReset({ id, username, email });
  }
}

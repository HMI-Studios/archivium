import { Request, Response, NextFunction } from 'express';
import api from '../api';
import { ADDR_PREFIX } from '../config';
import logger from '../logger';
import { ResultSetHeader } from 'mysql2/promise';
import { Session } from '../api/models/session';

const SESSION_LIFETIME_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const SESSION_REFRESH_THRESHOLD_MS = 1000 * 60 * 60 * 24; // 1 day

const createSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  let staleSession: Session | null = null;

  if (req.cookies['archiviumuid']) {
    const session = await api.session.getOne({ hash: req.cookies['archiviumuid'] });
    if (session) {
      const sessionAge = new Date().getTime() - session.created_at.getTime();
      if (sessionAge < SESSION_LIFETIME_MS) {
        req.session = {
          id: session.id,
          hash: session.hash,
          created_at: session.created_at,
        };
        if (session.user) {
          req.session = {
            ...req.session,
            user_id: session.user_id,
            user: session.user,
          }
        }

        res.cookie('archiviumuid', session.hash, {
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          maxAge: SESSION_LIFETIME_MS,
        });


        // Session is old enough that we should refresh it
        if (sessionAge > SESSION_REFRESH_THRESHOLD_MS) {
          await api.session.refresh(session.id);
        }
        return next();
      } else {
        // Session is older than 7 days, it needs to be replaced
        staleSession = session;
      }
    }
  }

  const { insertId } = await api.session.post();
  const session = await api.session.getOne({ id: insertId }) as Session; // We just created this session, so it must exist.
  res.cookie('archiviumuid', session.hash, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: SESSION_LIFETIME_MS,
  });
  req.session = {
    id: session.id,
    hash: session.hash,
    created_at: session.created_at,
  };
  if (staleSession) {
    if (staleSession.user_id) {
      await api.session.put({ id: session.id }, { user_id: staleSession.user_id });
      req.session = {
        ...req.session,
        user_id: staleSession.user_id,
        user: staleSession.user,
      }
    }
    await api.session.del({ id: staleSession.id });
  }
  next();
};

async function refreshSession(user: any) {
  await api.user.put(user.id, user.id, { updated_at: new Date() });
}

const verifySession = async (req: Request, res: Response, next: NextFunction) => {
  const user = req.session.user;
  if (user && user.verified) {
    await refreshSession(user);
    next();
  } else {
    res.sendStatus(401);
  }
}

const verifySessionOrRedirect = async (req: Request, res: Response, next: NextFunction) => {
  const user = req.session.user;
  if (user && user.verified) {
    await refreshSession(user);
    next();
  } else {
    const searchQueries = new URLSearchParams(req.query as Record<string, string>);
    const pageQuery = new URLSearchParams();
    pageQuery.append('page', req.path);
    if (searchQueries.toString()) pageQuery.append('search', searchQueries.toString());
    if (user && !user.verified) {
      res.redirect(`${ADDR_PREFIX}/verify?${pageQuery.toString()}`);
    } else {
      res.redirect(`${ADDR_PREFIX}/login?${pageQuery.toString()}`);
    }
  }
}

const bypassEmailVerification = async (req: Request, res: Response, next: NextFunction) => {
  const user = req.session.user;
  if (user) {
    user.verified = true;
  }
  next();
}

export default {
  createSession,
  verifySession,
  verifySessionOrRedirect,
  bypassEmailVerification,
};

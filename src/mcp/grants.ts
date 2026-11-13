import api from '../api';
import { perms } from '../api/utils';
import { User } from '../api/models/user';
import { Grant, GrantUniverseInput } from '../api/models/oauth';
import { Universe } from '../api/models/universe';
import * as gate from './gating';

export type GrantableUniverse = {
  id: number,
  shortname: string,
  title: string,
  items: boolean,
  notes: boolean,
};

function userPerms(universe: Universe, user: User): perms {
  return universe.author_permissions?.[user.id] ?? perms.NONE;
}

export async function grantableUniverses(user: User): Promise<GrantableUniverse[]> {
  const universes = await api.universe.getMany(user, null, perms.READ);
  return universes
    .map((u) => ({
      id: u.id,
      shortname: u.shortname,
      title: u.title,
      items: gate.itemsWritable(u) && userPerms(u, user) >= perms.WRITE,
      notes: gate.notesWritable(u),
    }))
    .filter((u) => u.items || u.notes)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function parseGrantForm(body: Record<string, unknown> | undefined, grantable: GrantableUniverse[]): GrantUniverseInput[] {
  const checked = (key: string) => body?.[key] === 'on' || body?.[key] === 'true';
  return grantable
    .map((u) => ({
      universe_id: u.id,
      items_write: u.items && checked(`items_write_${u.id}`),
      notes_write: u.notes && checked(`notes_write_${u.id}`),
    }))
    .filter((u) => u.items_write || u.notes_write);
}

export type GrantCheck = 'items' | 'notes';

export function grantAllows(grant: Grant, universeId: number, capability: GrantCheck): boolean {
  const row = grant.universes.find((u) => u.universe_id === universeId);
  if (!row) return false;
  return capability === 'items' ? row.items_write : row.notes_write;
}

export function grantHasAnyWrite(grant: Grant): boolean {
  return grant.universes.some((u) => u.items_write || u.notes_write);
}

import { tiers } from '../api/utils';

/**
 * MCP access is a premium-tier feature that a universe owner opts into per
 * capability. These helpers centralise the "is this universe/capability exposed
 * to MCP" decision so every tool applies the exact same gate on top of the
 * permission checks already enforced by the `api.*` model layer.
 *
 * DB returns BOOLEAN columns as 0/1, so we coerce with Boolean(). `tier` is the
 * universe's sponsored tier (null when unsponsored / free).
 */
type UniverseGate = {
  tier: number | null,
  mcp_items_enabled: boolean | number,
  mcp_notes_enabled: boolean | number,
  mcp_discussions_enabled: boolean | number,
};

export function isPremium(universe: UniverseGate): boolean {
  return universe.tier === tiers.PREMIUM;
}

export function itemsExposed(universe: UniverseGate): boolean {
  return isPremium(universe) && Boolean(universe.mcp_items_enabled);
}

export function notesExposed(universe: UniverseGate): boolean {
  return isPremium(universe) && Boolean(universe.mcp_notes_enabled);
}

export function discussionsExposed(universe: UniverseGate): boolean {
  return isPremium(universe) && Boolean(universe.mcp_discussions_enabled);
}

export function mcpVisible(universe: UniverseGate): boolean {
  return itemsExposed(universe) || notesExposed(universe) || discussionsExposed(universe);
}

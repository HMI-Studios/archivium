import { tiers } from '../api/utils';


export type UniverseGate = {
  tier: number | null,
  mcp_items_enabled: boolean | number,
  mcp_notes_enabled: boolean | number,
  mcp_discussions_enabled: boolean | number,
  mcp_items_write_enabled: boolean | number,
  mcp_notes_write_enabled: boolean | number,
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

export function itemsWritable(universe: UniverseGate): boolean {
  return itemsExposed(universe) && Boolean(universe.mcp_items_write_enabled);
}

export function notesWritable(universe: UniverseGate): boolean {
  return notesExposed(universe) && Boolean(universe.mcp_notes_write_enabled);
}

export function mcpVisible(universe: UniverseGate): boolean {
  return itemsExposed(universe) || notesExposed(universe) || discussionsExposed(universe);
}

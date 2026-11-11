// Trades a colonist can hold. A trade makes its work their first choice and part of who they are.

import type { WorkK } from '../types';

export interface ProfDef { k: string; name: string; work: WorkK; skill: number; blurb: string }

const p = (k: string, name: string, work: WorkK, skill: number, blurb: string): ProfDef => ({ k, name, work, skill, blurb });

export const PROF_LIST: ProfDef[] = [
  p('farmer', 'Farmer', 'farm', 4, 'Works the fields from thaw to frost.'),
  p('cook', 'Cook', 'cook', 5, 'Feeds the colony. Everyone has opinions about how.'),
  p('builder', 'Builder', 'build', 2, 'Raises walls and roofs.'),
  p('woodcutter', 'Woodcutter', 'wood', 2, 'Keeps the hearths burning.'),
  p('miner', 'Miner', 'mine', 3, 'Breaks stone and digs for ore.'),
  p('hunter', 'Hunter', 'hunt', 1, 'Brings meat and hides out of the wild.'),
  p('fisher', 'Fisher', 'fish', 9, 'Sits by the water with endless patience.'),
  p('brewer', 'Brewer', 'brew', 5, 'Turns grain into the reason people get through winter.'),
  p('smith', 'Blacksmith', 'smith', 7, 'Works the forge: tools, nails, blades.'),
  p('weaver', 'Weaver', 'craft', 6, 'Makes and mends what the colony wears.'),
  p('healer', 'Healer', 'heal', 8, 'Sets bones, binds wounds, sits with the dying.'),
  p('priest', 'Priest', 'preach', 10, 'Speaks for the gods, and to them.'),
  p('guard', 'Guard', 'guard', 0, 'Walks the edge of the colony with one hand on a weapon.'),
  p('lorekeeper', 'Lorekeeper', 'teach', 11, 'Keeps the stories and teaches the young.'),
];

export const PROFS: Record<string, ProfDef> = Object.fromEntries(PROF_LIST.map((x) => [x.k, x]));

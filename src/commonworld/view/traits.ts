// Plain-language hover text for people values and ruler traits. Keep in step with the sim
// (step.ts stabTarget/VALUE_GOAL, war.ts, econ.ts, diplo.ts CLASH, techs.ts VALUE_FX).

import type { RulerTrait, ValueId } from '../sim/types';

export const VALUE_TIP: Record<ValueId, string> = {
  curious: 'Research runs 50% faster and scholars appear more often. Favours learning techs. Clashes with devout and ancestral peoples.',
  devout: 'Temples calm towns more (+5 stability each instead of +3) and get built more often. Prophets appear more often. Clashes with curious peoples.',
  martial: 'Armies fight 15% harder and they keep more soldiers. Quicker to declare war, they build walls, and distant towns stay loyal. +3 stability.',
  mercantile: 'More trade routes and more coin. They build markets and merchants appear more often. Clashes with isolationists.',
  seafaring: 'Coastal and sea tiles feed them better, and they like settling on the coast. Favours sailing and trade techs.',
  stubborn: 'A steady people: +8 stability in every town. They like building walls.',
  artistic: 'Builds monuments and great works, and master builders appear more often. Favours stability and materials techs.',
  expansionist: 'Settles new land eagerly and is quicker to go to war. Favours techs that reach farther or grow more food. Clashes with isolationists.',
  isolationist: 'Settles away from neighbours, rarely starts wars, and others like them less. +4 stability. Clashes with expansionists and mercantile peoples.',
  egalitarian: 'A large realm stays united: the stability cost of having many towns is halved. Clashes with martial peoples.',
  ancestral: 'Towns grow steadier with age (up to +10 stability) and successions split the realm less often. Clashes with curious peoples.',
  pragmatic: 'Food first: farms and granaries come before everything else. Favours food and materials techs.',
};

export const RULER_TIP: Record<RulerTrait, string> = {
  bold: 'Quick to start wars and slow to make peace.',
  cautious: 'Keeps a larger army but is slow to start wars.',
  pious: 'Builds temples. +3 stability.',
  greedy: 'Chases trade, and towns earn 15% more coin. −2 stability.',
  wise: 'Research runs 15% faster.',
  cruel: 'Feared: −3 stability, neighbours like them less, wars come easily, and their death more often starts a succession crisis.',
  builder: 'Puts up great works and monuments.',
  just: 'Trusted: +4 stability, slow to start wars, and warm ties with other just rulers.',
};

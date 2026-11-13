// Names for each people. Every people has its own sounds for given names and its own way of
// making family names (humans and halflings from places, dwarves and orcs from deeds, goblins
// from insults they decided to keep).

import type { Rand } from './rng';
import type { RaceK } from './types';

interface Lang {
  /** given-name parts: start, middle (optional), end for women, end for men */
  a: string[]; m: string[]; f: string[]; e: string[];
  /** family-name parts */
  fa: string[]; fb: string[];
  /** chance of a middle syllable */
  mid: number;
}

const LANG: Record<string, Lang> = {
  human: {
    a: ['Al', 'Bran', 'Cor', 'Ed', 'Gar', 'Hal', 'Jor', 'Ken', 'Lor', 'Mar', 'Ned', 'Os', 'Per', 'Rob', 'Sim', 'Tom', 'Wil', 'Ber', 'Dun', 'Ro', 'El', 'Hel', 'Is', 'Ma', 'Syb', 'Tam', 'An', 'Gwen', 'Ros', 'Ad'],
    m: ['a', 'e', 'i', 'o', 'en', 'el', 'ri'],
    f: ['a', 'yn', 'ith', 'ene', 'ia', 'wen', 'ra', 'ild', 'eth', 'ina', 'ey'],
    e: ['ic', 'en', 'ard', 'ert', 'on', 'us', 'in', 'ald', 'ek', 'oc', 'an', 'yn'],
    fa: ['Ash', 'Black', 'Stone', 'Mill', 'Marsh', 'Wood', 'Green', 'Thorn', 'Fen', 'Hay', 'Red', 'Long', 'Cold', 'Wain', 'Fair', 'Hart', 'Oak', 'Barrow', 'Crow', 'Salt', 'Whit', 'Under', 'Grim', 'Hazel'],
    fb: ['down', 'wood', 'ford', 'field', 'brook', 'well', 'ton', 'wick', 'by', 'ham', 'ley', 'croft', 'dale', 'water', 'more', 'hurst', 'stead', 'gate', 'mere', 'thorpe'],
    mid: 0.25,
  },
  dwarf: {
    a: ['Thor', 'Bal', 'Dur', 'Gim', 'Dag', 'Bof', 'Kaz', 'Thra', 'Bor', 'Grun', 'Hul', 'Nor', 'Rag', 'Stor', 'Ulf', 'Brok', 'Dwal', 'Fund', 'Gar', 'Mor'],
    m: ['a', 'i', 'u', 'gri', 'da'],
    f: ['a', 'hild', 'dis', 'ga', 'na', 'run', 'vi', 'dra', 'ja'],
    e: ['in', 'ur', 'li', 'gar', 'rik', 'un', 'dir', 'bur', 'or', 'im', 'ak'],
    fa: ['Iron', 'Stone', 'Deep', 'Black', 'Bronze', 'Coal', 'Flint', 'Granite', 'Oath', 'Anvil', 'Hammer', 'Gold', 'Grim', 'Steel', 'Under', 'Long', 'Ash', 'Hard'],
    fb: ['foot', 'beard', 'hand', 'helm', 'delve', 'forge', 'brow', 'fist', 'hewer', 'keeper', 'shield', 'vein', 'mantle', 'back', 'born', 'breaker'],
    mid: 0.2,
  },
  elf: {
    a: ['Ae', 'Ela', 'Fae', 'Gala', 'Ili', 'Lae', 'Mae', 'Nae', 'Sil', 'Thae', 'Ari', 'Cae', 'Eli', 'Ith', 'Lue', 'Syl', 'Vae', 'Ysa', 'Ara', 'Ori'],
    m: ['la', 'ri', 'lo', 'na', 'the', 'li', 'ra', 'ni'],
    f: ['riel', 'wen', 'lith', 'neth', 'ra', 'syl', 'thiel', 'nae', 'dis', 'lia'],
    e: ['ion', 'las', 'dir', 'ros', 'thil', 'nor', 'rian', 'del', 'far', 'len'],
    fa: ['Moon', 'Silver', 'Star', 'Dawn', 'Dusk', 'Leaf', 'Wind', 'Rain', 'Night', 'Thorn', 'Swift', 'Mist', 'Elder', 'Summer', 'Winter', 'Wild', 'Song', 'Ever'],
    fb: ['whisper', 'leaf', 'bough', 'song', 'shade', 'brook', 'bloom', 'fall', 'runner', 'gleam', 'thorn', 'veil', 'wood', 'weaver', 'light', 'strider'],
    mid: 0.7,
  },
  halfling: {
    a: ['Pip', 'Bod', 'Mer', 'Sam', 'Ros', 'Dai', 'Per', 'Fro', 'Bil', 'Lob', 'Mil', 'Tol', 'Pop', 'Wil', 'Nib', 'Fen', 'Lil', 'Mar', 'Dod', 'Hob'],
    m: ['i', 'o', 'a', 'er', 'el'],
    f: ['a', 'ie', 'y', 'ella', 'ina', 'wyn', 'ola', 'bell'],
    e: ['o', 'in', 'ic', 'ard', 'ert', 'wise', 'kin', 'ly'],
    fa: ['Under', 'Good', 'Apple', 'Bramble', 'Butter', 'Honey', 'Tuck', 'Burrow', 'Green', 'Hay', 'Pudding', 'Thistle', 'Clover', 'Barley', 'Mug', 'Fair', 'Nettle', 'Oat'],
    fb: ['hill', 'body', 'bough', 'bottom', 'worth', 'foot', 'burrow', 'barrel', 'bank', 'wick', 'cake', 'down', 'meadow', 'pot', 'well', 'toes'],
    mid: 0.2,
  },
  orc: {
    a: ['Gra', 'Ur', 'Maz', 'Zog', 'Bol', 'Dur', 'Gor', 'Kru', 'Mog', 'Naz', 'Rok', 'Sha', 'Thok', 'Ug', 'Vor', 'Yaz', 'Bru', 'Gha', 'Hur', 'Lug'],
    m: ['g', 'r', 'z', 'ka', 'gu'],
    f: ['ka', 'sha', 'ra', 'gha', 'zra', 'a', 'rra', 'la'],
    e: ['kk', 'zog', 'gash', 'nak', 'ruk', 'dush', 'bag', 'lok', 'gor', 'mak', 'tar'],
    fa: ['Bone', 'Skull', 'Red', 'Black', 'Iron', 'Blood', 'Gut', 'Rot', 'Stone', 'Thunder', 'Ash', 'Night', 'Broken', 'Wolf', 'Sharp', 'Dead'],
    fb: ['breaker', 'tusk', 'fist', 'render', 'hide', 'jaw', 'eater', 'hand', 'splitter', 'howl', 'scar', 'tooth', 'maw', 'walker', 'biter', 'eye'],
    mid: 0.15,
  },
  goblin: {
    a: ['Snik', 'Grib', 'Zat', 'Nub', 'Skiz', 'Rik', 'Bix', 'Glok', 'Pok', 'Vex', 'Krat', 'Nix', 'Zub', 'Fiz', 'Mog', 'Tik', 'Splug', 'Yik', 'Gak', 'Wort'],
    m: ['i', 'a', 'o'],
    f: ['a', 'i', 'ka', 'la', 'sa', 'zi', 'tta', ''],
    e: ['', '', 'it', 'ot', 'ik', 'ag', 'le', 'o', 'ix', 'ek'],
    fa: ['Rat', 'Mud', 'Wart', 'Snot', 'Pin', 'Bent', 'Crook', 'Soot', 'Grub', 'Moss', 'Slink', 'Rust', 'Nail', 'Stink', 'Pot', 'Scab'],
    fb: ['finger', 'nose', 'tooth', 'ear', 'toe', 'picker', 'biter', 'belly', 'shanks', 'gob', 'snatch', 'wick', 'knuckle', 'licker', 'foot', 'eye'],
    mid: 0.1,
  },
};
LANG.halfelf = LANG.elf;
LANG.halforc = LANG.orc;

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export function givenName(r: Rand, race: RaceK, sex: 0 | 1): string {
  const L = race === 'halfelf' && r.chance(0.5) ? LANG.human : race === 'halforc' && r.chance(0.5) ? LANG.human : LANG[race];
  let s = r.pick(L.a);
  if (r.chance(L.mid)) s += r.pick(L.m);
  s += r.pick(sex === 0 ? L.f : L.e);
  // tidy doubled vowels and letters that read badly
  s = s.replace(/([aeiou])\1+/gi, '$1').replace(/(.)\1\1+/g, '$1$1');
  return cap(s);
}

export function familyName(r: Rand, race: RaceK): string {
  const L = race === 'halfelf' ? (r.chance(0.5) ? LANG.human : LANG.elf) : race === 'halforc' ? (r.chance(0.5) ? LANG.human : LANG.orc) : LANG[race];
  for (let k = 0; k < 8; k++) {
    const a = r.pick(L.fa);
    const b = r.pick(L.fb);
    if (a.toLowerCase() === b || a.toLowerCase().endsWith(b.slice(0, 3))) continue;
    return a + b;
  }
  return r.pick(L.fa) + r.pick(L.fb);
}

const PLACE_A = ['Hollow', 'Ash', 'Grey', 'Black', 'Cold', 'Raven', 'Thorn', 'Mire', 'Stone', 'Wolf', 'Crow', 'Red', 'Salt', 'Bleak', 'Gallows', 'Widow', 'Bitter', 'Drown', 'Rook', 'Hag', 'Iron', 'Fallow', 'Dusk', 'Lantern'];
const PLACE_B = ['ford', 'mere', 'hold', 'stead', 'wick', 'march', 'fell', 'moor', 'reach', 'barrow', 'haven', 'rest', 'watch', 'cross', 'water', 'gate', 'den', 'holt', 'well', 'field'];
const PLACE_OF = ['Last Hearth', 'Three Stones', 'Hangman\'s Rest', 'Sorrow\'s End', 'Dead Man\'s Ford', 'Old Bones', 'Wit\'s End', 'The Dregs', 'Mercy', 'Small Hope', 'Crooked Mile', 'Nowhere'];

export function colonyName(r: Rand): string {
  if (r.chance(0.1)) return r.pick(PLACE_OF);
  for (let k = 0; k < 8; k++) {
    const a = r.pick(PLACE_A);
    const b = r.pick(PLACE_B);
    if (a.toLowerCase().endsWith(b.charAt(0)) && a.toLowerCase().endsWith(b.slice(0, 2))) continue;
    return a + b;
  }
  return 'Hollowmere';
}

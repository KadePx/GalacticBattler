// Pace and calendar for Hollow Lands. The calendar shape is fixed per world; the real-time
// pace (how long a game day lasts) is one number the server can change at any time.

export const SIM_V = 1;

export const TICKS_PER_HOUR = 10; // one tick = 6 game minutes
export const HOURS_PER_DAY = 24;
export const TICKS_PER_DAY = TICKS_PER_HOUR * HOURS_PER_DAY; // 240
export const DAYS_PER_SEASON = 15;
export const SEASONS = 4;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS; // 60
export const TICKS_PER_YEAR = TICKS_PER_DAY * DAYS_PER_YEAR; // 14400

/** Real milliseconds per game day. 24 minutes = one game year per real day. Env: HL_MS_PER_DAY. */
export const DEFAULT_MS_PER_DAY = 1_440_000;

export const MAP_W = 72;
export const MAP_H = 72;

/** Tiles a healthy adult walks in one tick on open ground. */
export const WALK_SPEED = 12;

export const SOFT_CAP = 30;
export const HARD_CAP = 40;

export const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;

export interface When { year: number; season: number; day: number; dayOfYear: number; hour: number; minute: number }

export function when(tick: number): When {
  const dayAbs = Math.floor(tick / TICKS_PER_DAY);
  const inDay = tick - dayAbs * TICKS_PER_DAY;
  const year = Math.floor(dayAbs / DAYS_PER_YEAR);
  const dayOfYear = dayAbs - year * DAYS_PER_YEAR;
  const season = Math.floor(dayOfYear / DAYS_PER_SEASON);
  return {
    year: year + 1,
    season,
    day: dayOfYear - season * DAYS_PER_SEASON + 1,
    dayOfYear,
    hour: Math.floor(inDay / TICKS_PER_HOUR),
    minute: (inDay % TICKS_PER_HOUR) * 6,
  };
}

export const hourOf = (tick: number): number => Math.floor((tick % TICKS_PER_DAY) / TICKS_PER_HOUR);
export const dayOf = (tick: number): number => Math.floor(tick / TICKS_PER_DAY);
export const seasonOf = (tick: number): number => Math.floor((dayOf(tick) % DAYS_PER_YEAR) / DAYS_PER_SEASON);
export const yearsToTicks = (y: number): number => Math.round(y * TICKS_PER_YEAR);

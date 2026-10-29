// [ASSUMED] Independent T3: public opening LP bounds overtime; every value here is in game seconds.
export const BOSS_TAIL_MAX_GAME_SECONDS = 420;
export function publicLPTailHorizon(gd, round, openingTeamLP) {
  const base = (gd.bossLevelTime(round) || 120) * gd.combatTimeScale;
  const after = gd.bossOvertimeAfter, drain = gd.bossOvertimeDrain;
  if (!Number.isFinite(openingTeamLP) || openingTeamLP <= 0 || !Number.isFinite(after) || after < 0
    || !Number.isFinite(drain) || drain <= 0) return base;
  // gd already converts the real-time start and LP/sec to game-clock units.
  return Math.max(base, Math.min(BOSS_TAIL_MAX_GAME_SECONDS, after + Math.ceil(openingTeamLP / drain)));
}

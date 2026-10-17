# Strategy repository instructions

- Read README.md, CONTRIBUTING.md and the relevant docs/strategies page first.
- Keep one strategy object per core covenant. Preserve legacy AI and opening probabilities.
- Game rules, data, economy and legal-action checks belong to the upstream game.
- The released Arturia v0.1.0 policy is frozen. Never silently change its hashes or overwrite a version with different policy code.
- Run npm test and the appropriate integration/strategy tests for changes. Work only on isolated .cache fixtures, never the user's running game.
- After each confirmed strategy development cycle, run the complete existing unified suite with same-opening controls and update README plus that strategy's document. Do not select seeds using AI outcomes.
- This is the publishing and PR repository. Daily development and detailed findings stay in the original project dev branch. Public strategy descriptions must stay brief.
- No game art/audio, credentials, saves, installation recovery journals or private conversation logs in Git. Never upload .cache or dist wholesale.
- Preserve GPL-3.0-or-later attribution. Keep the project non-commercial.

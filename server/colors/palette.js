const PLAYER_COLOR_CATALOG = Object.freeze([
  { colorId: 'red', colorHex: '#ef4444' },
  { colorId: 'orange', colorHex: '#f97316' },
  { colorId: 'amber', colorHex: '#f59e0b' },
  { colorId: 'yellow', colorHex: '#eab308' },
  { colorId: 'lime', colorHex: '#84cc16' },
  { colorId: 'green', colorHex: '#22c55e' },
  { colorId: 'emerald', colorHex: '#10b981' },
  { colorId: 'teal', colorHex: '#14b8a6' },
  { colorId: 'cyan', colorHex: '#06b6d4' },
  { colorId: 'sky', colorHex: '#0ea5e9' },
  { colorId: 'blue', colorHex: '#3b82f6' },
  { colorId: 'indigo', colorHex: '#6366f1' },
  { colorId: 'violet', colorHex: '#8b5cf6' },
  { colorId: 'purple', colorHex: '#a855f7' },
  { colorId: 'pink', colorHex: '#ec4899' },
  { colorId: 'rose', colorHex: '#f43f5e' },
  { colorId: 'slate', colorHex: '#64748b' },
  { colorId: 'stone', colorHex: '#78716c' },
  { colorId: 'fuchsia', colorHex: '#d946ef' },
  { colorId: 'navy', colorHex: '#1e3a8a' },
  { colorId: 'aqua', colorHex: '#22d3ee' },
  { colorId: 'mint', colorHex: '#34d399' },
  { colorId: 'gold', colorHex: '#fbbf24' },
  { colorId: 'neutral', colorHex: '#a3a3a3' }
]);

const PLAYER_COLOR_BY_ID = Object.freeze(
  PLAYER_COLOR_CATALOG.reduce((lookup, colorDefinition) => {
    lookup[colorDefinition.colorId] = colorDefinition;
    return lookup;
  }, {})
);

module.exports = {
  PLAYER_COLOR_CATALOG,
  PLAYER_COLOR_BY_ID
};
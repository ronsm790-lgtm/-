export interface ClassColorTheme {
  rowBg: string;
  rowHoverBg: string;
  cardBg: string;
  cardBorder: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  accentHex: string;
  softHex: string;
}

const CLASS_COLOR_THEMES: ClassColorTheme[] = [
  // 0: الرابع العلمي — Sky Blue (هادئ أزرق سماوي)
  {
    rowBg: 'bg-sky-50/65',
    rowHoverBg: 'hover:bg-sky-100/60',
    cardBg: 'bg-sky-50/50',
    cardBorder: 'border-sky-200',
    badgeBg: 'bg-sky-100',
    badgeText: 'text-sky-900',
    badgeBorder: 'border-sky-300',
    accentHex: '#0369A1',
    softHex: '#F0F9FF',
  },
  // 1: الرابع الأدبي — Soft Teal / Mint (أخضر نعناعي هادئ)
  {
    rowBg: 'bg-teal-50/65',
    rowHoverBg: 'hover:bg-teal-100/60',
    cardBg: 'bg-teal-50/50',
    cardBorder: 'border-teal-200',
    badgeBg: 'bg-teal-100',
    badgeText: 'text-teal-900',
    badgeBorder: 'border-teal-300',
    accentHex: '#0F766E',
    softHex: '#F0FDFA',
  },
  // 2: الخامس العلمي — Soft Emerald / Sage (أخضر زمردي هادئ)
  {
    rowBg: 'bg-emerald-50/65',
    rowHoverBg: 'hover:bg-emerald-100/60',
    cardBg: 'bg-emerald-50/50',
    cardBorder: 'border-emerald-200',
    badgeBg: 'bg-emerald-100',
    badgeText: 'text-emerald-900',
    badgeBorder: 'border-emerald-300',
    accentHex: '#047857',
    softHex: '#ECFDF5',
  },
  // 3: الخامس الأدبي — Soft Amber / Sand (كهرماني رملي خافت)
  {
    rowBg: 'bg-amber-50/65',
    rowHoverBg: 'hover:bg-amber-100/60',
    cardBg: 'bg-amber-50/50',
    cardBorder: 'border-amber-200',
    badgeBg: 'bg-amber-100',
    badgeText: 'text-amber-950',
    badgeBorder: 'border-amber-300',
    accentHex: '#B45309',
    softHex: '#FFFBEB',
  },
  // 4: السادس العلمي — Soft Indigo / Violet (نيلي خافت)
  {
    rowBg: 'bg-indigo-50/65',
    rowHoverBg: 'hover:bg-indigo-100/60',
    cardBg: 'bg-indigo-50/50',
    cardBorder: 'border-indigo-200',
    badgeBg: 'bg-indigo-100',
    badgeText: 'text-indigo-950',
    badgeBorder: 'border-indigo-300',
    accentHex: '#4338CA',
    softHex: '#EEF2FF',
  },
  // 5: السادس الأدبي — Soft Rose / Blush (وردي ترابي خافت)
  {
    rowBg: 'bg-rose-50/60',
    rowHoverBg: 'hover:bg-rose-100/55',
    cardBg: 'bg-rose-50/45',
    cardBorder: 'border-rose-200',
    badgeBg: 'bg-rose-100',
    badgeText: 'text-rose-950',
    badgeBorder: 'border-rose-300',
    accentHex: '#BE123C',
    softHex: '#FFF1F2',
  },
];

export function getClassColorTheme(
  classNameOrId?: string | number | null
): ClassColorTheme {
  const raw = String(classNameOrId ?? '').trim();
  if (raw.includes('الرابع') && raw.includes('علمي')) return CLASS_COLOR_THEMES[0];
  if (raw.includes('الرابع') && raw.includes('أدبي')) return CLASS_COLOR_THEMES[1];
  if (raw.includes('الخامس') && raw.includes('علمي')) return CLASS_COLOR_THEMES[2];
  if (raw.includes('الخامس') && raw.includes('أدبي')) return CLASS_COLOR_THEMES[3];
  if (raw.includes('السادس') && raw.includes('علمي')) return CLASS_COLOR_THEMES[4];
  if (raw.includes('السادس') && raw.includes('أدبي')) return CLASS_COLOR_THEMES[5];

  const num = Number(classNameOrId);
  if (Number.isFinite(num) && num > 0) {
    return CLASS_COLOR_THEMES[(Math.abs(Math.floor(num)) - 1) % CLASS_COLOR_THEMES.length];
  }
  return CLASS_COLOR_THEMES[0];
}

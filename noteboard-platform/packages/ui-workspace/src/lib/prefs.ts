/** App preferences (same fields as the desktop app's prefs.json). */
export type ThemePref = 'Light' | 'Dark' | 'System';

export interface Prefs {
  theme: ThemePref;
  manual_dark: boolean;
  /** 0 small, 1 medium, 2 large. */
  scale: number;
  bold_headings: boolean;
  drawer_open: boolean;
  guides: boolean;
  snap_grid: boolean;
  show_grid: boolean;
  hidden_tools: string[];
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'Light',
  manual_dark: false,
  scale: 1,
  bold_headings: true,
  drawer_open: false,
  guides: true,
  snap_grid: false,
  show_grid: true,
  hidden_tools: [],
};

export const SCALES: [string, number][] = [
  ['Small', 0.9],
  ['Medium', 1],
  ['Large', 1.12],
];

/** Card background colours (index 0 follows the theme); dark variants are mixed toward the dark card. */
export const CARD_COLORS: [string, string, string][] = [
  ['Default', 'var(--nb-card)', 'var(--nb-card)'],
  ['Yellow', '#F7EEC4', '#5a5440'],
  ['Green', '#DFEFDA', '#4a5547'],
  ['Blue', '#DDE8F8', '#48505b'],
  ['Pink', '#F8DFE4', '#5b4b4e'],
  ['Purple', '#E9E1F6', '#524d5a'],
  ['Grey', '#ECEDEC', '#555655'],
];

export const BOARD_COLORS: [string, string][] = [
  ['Default', 'var(--nb-board-default)'],
  ['Lemon', '#EEECB4'],
  ['Clay', '#D59A84'],
  ['Sage', '#B8D4B0'],
  ['Sky', '#AEC9EA'],
  ['Lilac', '#CBBCE8'],
  ['Blush', '#F0BEC8'],
  ['Blue', '#4378D6'],
  ['Coral', '#E07A5F'],
  ['Green', '#3D9970'],
  ['Amber', '#E1AE3C'],
  ['Purple', '#8E6CC8'],
  ['Teal', '#3E9CA6'],
  ['Charcoal', '#4A504D'],
];

export const LINE_COLORS: [string, string][] = [
  ['Default', 'var(--nb-line)'],
  ['Blue', '#4378D6'],
  ['Red', '#D1554F'],
  ['Green', '#3D9970'],
  ['Amber', '#E1AE3C'],
  ['Grey', '#8A908D'],
];

export const BOARD_ICONS: [string, string][] = [
  ['😀', 'smile happy face'], ['😎', 'cool sunglasses face'], ['🙂', 'calm face'], ['😍', 'love face'],
  ['🤔', 'thinking idea face'], ['😴', 'sleep tired face'], ['🔥', 'fire hot'], ['⭐', 'star favourite'],
  ['💡', 'idea light bulb'], ['📌', 'pin important'], ['📁', 'folder files'], ['📚', 'books reading study'],
  ['🎨', 'art design paint'], ['🎵', 'music song'], ['🏠', 'home house'], ['✈', 'travel plane trip'],
  ['🚀', 'launch rocket project'], ['🌱', 'grow plant garden'], ['🌍', 'world earth global'], ['💼', 'work business'],
  ['📝', 'notes writing'], ['📷', 'photo camera'], ['🎬', 'film video movie'], ['🍀', 'luck clover'],
  ['❤', 'heart love'], ['⚡', 'energy fast'], ['🛠', 'tools build'], ['🎯', 'goal target'],
  ['📊', 'chart data report'], ['📅', 'calendar plan date'], ['💬', 'chat talk message'], ['🔒', 'lock private'],
  ['🎁', 'gift present'], ['🐱', 'cat pet'], ['🐶', 'dog pet'], ['🌙', 'moon night'],
  ['☀', 'sun day'], ['🍕', 'food pizza'], ['☕', 'coffee break'], ['🏆', 'trophy win'],
  ['🎮', 'game play'], ['🧩', 'puzzle piece'], ['📦', 'box package'], ['🔔', 'bell reminder'],
  ['🌊', 'wave sea ocean'], ['🏔', 'mountain'], ['🎓', 'school learn'], ['💰', 'money budget'],
];

/** Board colours whose symbol and outline should be light. */
export function boardIsDark(i: number): boolean {
  return i >= 7 && i !== 10;
}

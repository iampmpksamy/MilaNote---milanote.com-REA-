/**
 * Checks a board store sent by a client before it is saved: the shape must match the shared
 * board model, sizes are bounded, and link addresses with unsafe schemes are blanked.
 */
import type { Store } from './types';

export interface StoreCheck {
  ok: boolean;
  errors: string[];
  /** Link addresses that were blanked because their scheme isn't allowed. */
  blankedLinks: number;
  counts: { boards: number; cards: number; arrows: number };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPt = (v: unknown) => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);
const SAFE_URL = /^(https?:|mailto:|tel:)/i;
// Control characters are exactly what this rejects.
// eslint-disable-next-line no-control-regex
export const SAFE_ASSET_NAME = /^[^/\\\x00-\x1f]{1,200}$/;

export function safeLinkUrl(u: string): boolean {
  const t = u.trim();
  if (!t) return true;
  if (SAFE_URL.test(t)) return true;
  // Plain addresses like "example.com/page" are fine (the client adds https://).
  return !/^[a-z][a-z0-9+.-]*:/i.test(t);
}

const KINDS = ['Note', 'Todo', 'Link', 'Image', 'Board', 'Column', 'Heading', 'Color', 'Document', 'Sketch', 'Audio', 'Video', 'Map', 'Comment', 'Table'];
const isStr = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;

/** Shape and size limits of the card kinds added in 3.0.0-alpha.6. Returns a problem or null. */
function checkContent(content: Record<string, Record<string, unknown>>, kind: string): string | null {
  const v = content[kind];
  if (!v || typeof v !== 'object') return 'has no content';
  switch (kind) {
    case 'Heading':
      return isStr(v['text'], 2000) && [1, 2, 3].includes(v['size'] as number) ? null : 'heading is invalid';
    case 'Color':
      return isStr(v['hex'], 9) && /^#[0-9a-f]{6}$/i.test(v['hex'] as string) && isStr(v['name'], 200) ? null : 'colour is invalid';
    case 'Document':
      return isStr(v['title'], 500) && isStr(v['text'], 1_000_000) ? null : 'document is invalid or too long';
    case 'Sketch': {
      const strokes = v['strokes'];
      if (!Array.isArray(strokes) || strokes.length > 5000 || !isNum(v['aspect']) || typeof v['background'] !== 'boolean') return 'sketch is invalid';
      let points = 0;
      for (const st of strokes as Record<string, unknown>[]) {
        if (!st || !isStr(st['color'], 32) || !isNum(st['width']) || !Array.isArray(st['points'])) return 'sketch stroke is invalid';
        points += (st['points'] as unknown[]).length;
        if (!(st['points'] as unknown[]).every(isNum)) return 'sketch stroke is invalid';
      }
      return points > 400_000 ? 'sketch is too large' : null;
    }
    case 'Audio':
      return (v['file'] === '' || (isStr(v['file'], 200) && SAFE_ASSET_NAME.test(v['file'] as string))) && isStr(v['title'], 500) && isNum(v['duration']) ? null : 'audio is invalid';
    case 'Video':
      return isStr(v['url'], 2000) && (v['file'] === '' || (isStr(v['file'], 200) && SAFE_ASSET_NAME.test(v['file'] as string))) && isStr(v['title'], 500) && isNum(v['aspect']) ? null : 'video is invalid';
    case 'Map':
      return isStr(v['query'], 500) && isStr(v['label'], 500) && (v['lat'] === null || isNum(v['lat'])) && (v['lng'] === null || isNum(v['lng'])) && isNum(v['zoom']) ? null : 'map is invalid';
    case 'Comment': {
      const e = v['entries'];
      if (!Array.isArray(e) || e.length > 2000 || typeof v['resolved'] !== 'boolean') return 'comment is invalid';
      return (e as Record<string, unknown>[]).every((x) => x && isStr(x['text'], 20_000) && isStr(x['author'], 200) && isNum(x['at'])) ? null : 'comment entry is invalid';
    }
    case 'Table': {
      const cells = v['cells'];
      if (!isStr(v['title'], 500) || !Array.isArray(cells) || cells.length > 500) return 'table is invalid';
      return (cells as unknown[]).every((r) => Array.isArray(r) && r.length <= 100 && r.every((x) => isStr(x, 10_000))) ? null : 'table is invalid or too large';
    }
    default:
      return null;
  }
}

export function checkStore(s: unknown, limits = { boards: 5000, cardsPerBoard: 20000 }): StoreCheck {
  const errors: string[] = [];
  const res: StoreCheck = { ok: false, errors, blankedLinks: 0, counts: { boards: 0, cards: 0, arrows: 0 } };
  if (!s || typeof s !== 'object') {
    errors.push('not an object');
    return res;
  }
  const st = s as Store;
  if (!st.boards || typeof st.boards !== 'object' || Array.isArray(st.boards)) errors.push('boards must be an object');
  if (!isNum(st.root)) errors.push('root must be a number');
  if (!isNum(st.next_id)) errors.push('next_id must be a number');
  if (!Array.isArray(st.trash)) errors.push('trash must be a list');
  if (!isNum(st.version)) errors.push('version must be a number');
  if (errors.length) return res;
  const ids = Object.keys(st.boards);
  if (ids.length > limits.boards) errors.push(`too many boards (${ids.length})`);
  if (!st.boards[String(st.root)]) errors.push('the home board is missing');
  for (const key of ids) {
    const b = st.boards[key];
    const where = `board ${key}`;
    if (!b || typeof b !== 'object') {
      errors.push(`${where}: not an object`);
      continue;
    }
    if (String(b.id) !== key) errors.push(`${where}: id does not match its key`);
    if (typeof b.name !== 'string' || b.name.length > 500) errors.push(`${where}: name must be text up to 500 characters`);
    if (!(b.parent === null || isNum(b.parent))) errors.push(`${where}: parent must be a number or null`);
    if (!Array.isArray(b.cards) || !Array.isArray(b.arrows) || !Array.isArray(b.unsorted)) {
      errors.push(`${where}: cards, arrows and unsorted must be lists`);
      continue;
    }
    if (b.cards.length > limits.cardsPerBoard) errors.push(`${where}: too many cards`);
    if (!isPt(b.pan) || !isNum(b.zoom)) errors.push(`${where}: pan/zoom are invalid`);
    for (const c of b.cards) {
      if (!c || !isNum(c.id) || !isPt(c.pos) || !isNum(c.width) || !c.content || typeof c.content !== 'object') {
        errors.push(`${where}: a card is malformed`);
        break;
      }
      const kind = Object.keys(c.content)[0];
      if (!KINDS.includes(kind) || Object.keys(c.content).length !== 1) {
        errors.push(`${where}: card ${c.id} has an unknown kind`);
        break;
      }
      const problem = checkContent(c.content as unknown as Record<string, Record<string, unknown>>, kind);
      if (problem) {
        errors.push(`${where}: card ${c.id} ${problem}`);
        break;
      }
      if ('Video' in c.content && typeof c.content.Video.url === 'string' && !safeLinkUrl(c.content.Video.url)) {
        c.content.Video.url = '';
        res.blankedLinks++;
      }
      if ('Link' in c.content) {
        const l = c.content.Link;
        if (typeof l.url !== 'string') errors.push(`${where}: card ${c.id} link address must be text`);
        else if (!safeLinkUrl(l.url)) {
          l.url = '';
          res.blankedLinks++;
        }
      }
      if ('Image' in c.content && (typeof c.content.Image.file !== 'string' || !SAFE_ASSET_NAME.test(c.content.Image.file)))
        errors.push(`${where}: card ${c.id} picture name is invalid`);
    }
    for (const a of b.arrows)
      if (!a || !isNum(a.id) || !isNum(a.from) || !isNum(a.to)) {
        errors.push(`${where}: a line is malformed`);
        break;
      }
    res.counts.boards++;
    res.counts.cards += b.cards.length;
    res.counts.arrows += b.arrows.length;
  }
  res.ok = errors.length === 0;
  return res;
}

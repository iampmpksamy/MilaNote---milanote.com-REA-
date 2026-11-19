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
      if (!['Note', 'Todo', 'Link', 'Image', 'Board', 'Column'].includes(kind) || Object.keys(c.content).length !== 1) {
        errors.push(`${where}: card ${c.id} has an unknown kind`);
        break;
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

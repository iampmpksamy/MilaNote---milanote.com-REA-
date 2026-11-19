/**
 * The board data model, shared by every Noteboard client (web, desktop, mobile) and the server.
 *
 * It is the same shape as the Rust desktop app's `boards.json` (format version 2), so a file saved
 * by one can be read by the other. Field names follow that file exactly.
 */

export type CardId = number;
export type BoardId = number;

/** Where a card lives: on the canvas, inside a column, or in the Unsorted drawer. */
export type Container = 'Canvas' | 'Unsorted' | { Column: CardId };

export interface TodoItem {
  text: string;
  done: boolean;
}

export type Content =
  | { Note: { text: string } }
  | { Todo: { title: string; items: TodoItem[] } }
  | { Link: { url: string; title: string } }
  | { Image: { file: string; caption: string; aspect: number } }
  | { Board: { board: BoardId } }
  | { Column: { title: string; children: CardId[] } };

export type ContentKind = 'Note' | 'Todo' | 'Link' | 'Image' | 'Board' | 'Column';

export interface Card {
  id: CardId;
  pos: [number, number];
  width: number;
  color: number;
  z: number;
  container: Container;
  locked: boolean;
  /** Note text alignment: 0 left, 1 centre, 2 right. */
  align: number;
  content: Content;
}

export interface Arrow {
  id: number;
  /** Card the line starts at, or 0 when the start is a free point (`from_pt`). */
  from: CardId;
  to: CardId;
  color: number;
  dashed: boolean;
  head: boolean;
  head_start: boolean;
  /** 1 thin, 2 medium, 3 thick. */
  weight: number;
  label: string;
  from_pt: [number, number] | null;
  to_pt: [number, number] | null;
}

export interface Board {
  id: BoardId;
  name: string;
  parent: BoardId | null;
  color: number;
  icon: string | null;
  cards: Card[];
  arrows: Arrow[];
  unsorted: CardId[];
  pan: [number, number];
  zoom: number;
}

export interface TrashItem {
  id: number;
  board: BoardId;
  cards: Card[];
  arrows: Arrow[];
  deleted_at: number;
}

export interface Store {
  /** Keyed by board id (as a string, like JSON object keys). */
  boards: Record<string, Board>;
  root: BoardId;
  next_id: number;
  trash: TrashItem[];
  version: number;
}

export const STORE_VERSION = 2;

export function kindOf(content: Content): ContentKind {
  return Object.keys(content)[0] as ContentKind;
}

export function isColumnContainer(c: Container): c is { Column: CardId } {
  return typeof c === 'object' && c !== null && 'Column' in c;
}

export function containerEquals(a: Container, b: Container): boolean {
  if (isColumnContainer(a) && isColumnContainer(b)) return a.Column === b.Column;
  return a === b;
}

export const KIND_NAMES: Record<ContentKind, string> = {
  Note: 'Note',
  Todo: 'To-do list',
  Link: 'Link',
  Image: 'Image',
  Board: 'Board',
  Column: 'Column',
};

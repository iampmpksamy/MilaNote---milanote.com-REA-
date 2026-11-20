/** A small ustar writer and reader (regular files only) for backups and exports, gzip-compressed. */
import fs from 'node:fs';
import { Readable, type Writable } from 'node:stream';
import zlib from 'node:zlib';

function header(name: string, size: number, mtime: Date): Buffer {
  const h = Buffer.alloc(512);
  let prefix = '';
  let base = name;
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf('/', 154);
    if (cut <= 0 || Buffer.byteLength(name.slice(cut + 1)) > 100) throw new Error(`path too long for tar: ${name}`);
    prefix = name.slice(0, cut);
    base = name.slice(cut + 1);
  }
  const oct = (n: number, len: number) => n.toString(8).padStart(len - 1, '0') + '\0';
  h.write(base, 0, 100, 'utf8');
  h.write(oct(0o600, 8), 100);
  h.write(oct(0, 8), 108);
  h.write(oct(0, 8), 116);
  h.write(oct(size, 12), 124);
  h.write(oct(Math.floor(mtime.getTime() / 1000), 12), 136);
  h.write('        ', 148);
  h.write('0', 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  h.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(oct(sum, 7) + ' ', 148);
  return h;
}

export class TarWriter {
  private readonly gz = zlib.createGzip({ level: 6 });
  private readonly done: Promise<void>;
  constructor(out: Writable) {
    this.gz.pipe(out);
    this.done = new Promise((resolve, reject) => {
      out.on('finish', resolve);
      out.on('close', resolve);
      out.on('error', reject);
      this.gz.on('error', reject);
    });
  }
  private write(b: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const ok = this.gz.write(b, (err) => (err ? reject(err) : undefined));
      if (ok) resolve();
      else this.gz.once('drain', resolve);
    });
  }
  async addBuffer(name: string, data: Buffer, mtime = new Date()): Promise<void> {
    await this.write(header(name, data.length, mtime));
    await this.write(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) await this.write(Buffer.alloc(pad));
  }
  async addStream(name: string, size: number, src: Readable, mtime = new Date()): Promise<void> {
    await this.write(header(name, size, mtime));
    let n = 0;
    for await (const chunk of src) {
      n += (chunk as Buffer).length;
      await this.write(chunk as Buffer);
    }
    if (n !== size) throw new Error(`size changed while archiving ${name}`);
    const pad = (512 - (size % 512)) % 512;
    if (pad) await this.write(Buffer.alloc(pad));
  }
  async addFile(name: string, file: string): Promise<void> {
    const st = await fs.promises.stat(file);
    await this.addStream(name, st.size, fs.createReadStream(file), st.mtime);
  }
  async finish(): Promise<void> {
    await this.write(Buffer.alloc(1024));
    this.gz.end();
    await this.done;
  }
}

export interface TarEntry {
  name: string;
  size: number;
}

/**
 * Calls `onEntry` for every file in a .tar.gz with a readable for its content, streamed in pieces
 * (large audio/video files are never held whole in memory). The content not read by `onEntry` is
 * skipped. Linear time: chunks are queued, never concatenated over and over.
 */
export async function readTarGz(file: string, onEntry: (e: TarEntry, body: Readable) => Promise<void>): Promise<void> {
  const src = fs.createReadStream(file).pipe(zlib.createGunzip());
  const it = src[Symbol.asyncIterator]();
  const chunks: Buffer[] = [];
  let have = 0;
  let ended = false;
  const fill = async (n: number) => {
    while (have < n && !ended) {
      const r = await it.next();
      if (r.done) ended = true;
      else {
        chunks.push(r.value as Buffer);
        have += (r.value as Buffer).length;
      }
    }
    return have >= n;
  };
  /** Takes exactly n buffered bytes (n <= have) as pieces. */
  function* take(n: number): Generator<Buffer> {
    let left = n;
    while (left > 0) {
      const c = chunks[0];
      if (c.length <= left) {
        chunks.shift();
        have -= c.length;
        left -= c.length;
        yield c;
      } else {
        chunks[0] = c.subarray(left);
        have -= left;
        yield c.subarray(0, left);
        left = 0;
      }
    }
  }
  const read = (n: number) => Buffer.concat([...take(n)]);
  for (;;) {
    if (!(await fill(512))) break;
    const h = read(512);
    if (h.every((b) => b === 0)) break;
    const str = (o: number, l: number) => h.toString('utf8', o, o + l).replace(/\0.*$/s, '');
    const size = parseInt(str(124, 12).trim() || '0', 8);
    const prefix = str(345, 155);
    const name = (prefix ? prefix + '/' : '') + str(0, 100);
    const type = String.fromCharCode(h[156] || 48);
    const pad = (512 - (size % 512)) % 512;
    let left = size;
    // The entry's content, handed out as it arrives.
    async function* body(): AsyncGenerator<Buffer> {
      while (left > 0) {
        if (!have && !(await fill(1))) throw new Error('backup file is truncated');
        const n = Math.min(left, have, 1 << 20);
        for (const c of take(n)) yield c;
        left -= n;
      }
    }
    // One reader per entry: what the callback didn't read is drained from the same stream.
    const stream = Readable.from(body());
    if (type === '0' || type === '\0') {
      if (name.startsWith('/') || name.split('/').includes('..')) throw new Error(`unsafe path in archive: ${name}`);
      await onEntry({ name, size }, stream);
    }
    if (!stream.readableEnded && !stream.destroyed) for await (const _ of stream) void _;
    if (left > 0) throw new Error('backup file could not be read to the end of an entry');
    if (pad) {
      if (!(await fill(pad))) throw new Error('backup file is truncated');
      for (const _ of take(pad)) void _;
    }
  }
}

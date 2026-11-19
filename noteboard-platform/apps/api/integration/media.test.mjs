// Audio and video files for the boards: recognised by their content, their own size limit, and
// served in parts (HTTP Range) so players can seek. Run: npx nx run api:integration
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { client, PNG, startServer } from './harness.mjs';

const PW = 'correct horse battery 42';
const MB = 1048576;
let srv;
let me;
let myId;

/** A WAV file: RIFF/WAVE header + `bytes` of silence (8 kHz, 8-bit mono). */
function wav(bytes) {
  const b = Buffer.alloc(44 + bytes, 0x80);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(36 + bytes, 4);
  b.write('WAVEfmt ', 8, 'latin1');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(8000, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write('data', 36, 'latin1');
  b.writeUInt32LE(bytes, 40);
  // A recognisable pattern so the byte ranges can be checked.
  for (let i = 44; i < b.length; i++) b[i] = i % 251;
  return b;
}

/** An ISO media file that starts with an 'ftyp' box of the given brands. */
function ftyp(major, ...compatible) {
  const box = Buffer.alloc(16 + 4 * compatible.length);
  box.writeUInt32BE(box.length, 0);
  box.write('ftyp', 4, 'latin1');
  box.write(major, 8, 'latin1');
  compatible.forEach((c, i) => box.write(c, 16 + 4 * i, 'latin1'));
  const mdat = Buffer.alloc(32);
  mdat.writeUInt32BE(32, 0);
  mdat.write('mdat', 4, 'latin1');
  return Buffer.concat([box, mdat]);
}

const pad = (head, n = 64) => Buffer.concat([head, Buffer.alloc(n)]);
const EBML = Buffer.from('1a45dfa3a3428286810142f7810142f2810442f381084282847765626d', 'hex');

before(async () => {
  srv = await startServer({ MAX_UPLOAD_MB: '1', MAX_MEDIA_MB: '2', ADMIN_MFA_REQUIRED: 'false' });
  me = client(srv.base);
  await me.get('/api/v1/discovery');
  const r = await me.post('/api/v1/setup', { token: srv.setupToken(), name: 'Mia Media', email: 'mia@example.com', password: PW, passwordConfirm: PW });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  myId = (await me.get('/api/v1/me')).data.user.id;
});
after(async () => {
  await srv?.stop();
});

const put = (name, body, type) => me.req('PUT', `/api/v1/assets/${encodeURIComponent(name)}`, body, { 'content-type': type });

describe('audio and video uploads', () => {
  it('tells the advertised limits', async () => {
    const d = await me.get('/api/v1/discovery');
    assert.equal(d.data.features.maxUploadMb, 1);
    assert.equal(d.data.features.maxMediaMb, 2);
  });

  it('recognises audio formats by their content', async () => {
    const cases = [
      ['a.wav', wav(400), 'audio/wav', 'audio/wav'],
      ['a.mp3', pad(Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00', 'latin1')), 'audio/mpeg', 'audio/mpeg'],
      ['b.mp3', pad(Buffer.from('fffb9064', 'hex')), 'audio/mpeg', 'audio/mpeg'],
      ['a.m4a', ftyp('M4A ', 'M4A ', 'mp42', 'isom'), 'audio/mp4', 'audio/x-m4a'],
      ['a.ogg', pad(Buffer.from('OggS\x00\x02', 'latin1')), 'audio/ogg', 'audio/ogg'],
      ['a.flac', pad(Buffer.from('fLaC\x00\x00\x00\x22', 'latin1')), 'audio/flac', 'audio/flac'],
      ['voice.webm', pad(EBML), 'audio/webm', 'audio/webm;codecs=opus'],
      // A recording from a phone: an MP4 container declared as audio.
      ['voice.mp4', ftyp('isom', 'isom', 'mp41'), 'audio/mp4', 'audio/mp4'],
      // The name never decides: a WAV called .png is still audio.
      ['sneaky.png', wav(100), 'audio/wav', 'application/octet-stream'],
    ];
    for (const [name, body, mime, declared] of cases) {
      const r = await put(name, body, declared);
      assert.equal(r.status, 200, `${name}: ${JSON.stringify(r.data)}`);
      assert.equal(r.data.mime, mime, name);
      const got = await me.get(`/api/v1/assets/${name}`);
      assert.equal(got.headers.get('content-type'), mime, name);
      assert.deepEqual(got.data, body, name);
    }
  });

  it('recognises video formats', async () => {
    const cases = [
      ['v.mp4', ftyp('isom', 'isom', 'iso2', 'avc1', 'mp41'), 'video/mp4', 'video/mp4'],
      ['v2.mp4', ftyp('mp42', 'mp42', 'isom'), 'video/mp4', 'application/octet-stream'],
      ['v.mov', ftyp('qt  ', 'qt  '), 'video/quicktime', 'video/quicktime'],
      ['v.webm', pad(EBML), 'video/webm', 'video/webm'],
    ];
    for (const [name, body, mime, declared] of cases) {
      const r = await put(name, body, declared);
      assert.equal(r.status, 200, `${name}: ${JSON.stringify(r.data)}`);
      assert.equal(r.data.mime, mime, name);
    }
  });

  it('refuses files that only pretend to be audio or video', async () => {
    const fakes = [
      ['fake.mp3', Buffer.from('<html><script>alert(1)</script></html>'), 'audio/mpeg'],
      ['fake.mp4', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'video/mp4'],
      // An 'ftyp' box of a picture format the boards don't take (HEIC).
      ['photo.mp4', ftyp('heic', 'mif1', 'heic'), 'video/mp4'],
      // AAC without a container (ADTS) and random bytes after a sync word are not MP3.
      ['adts.mp3', pad(Buffer.from('fff15080', 'hex')), 'audio/mpeg'],
      ['short.wav', Buffer.from('RIFF'), 'audio/wav'],
    ];
    for (const [name, body, type] of fakes) {
      const r = await put(name, body, type);
      assert.equal(r.status, 415, `${name} should be refused: ${JSON.stringify(r.data)}`);
      assert.equal(r.data.error.code, 'unsupported_type');
    }
    assert.equal((await me.get('/api/v1/assets/fake.mp3')).status, 404);
  });

  it('keeps pictures to MAX_UPLOAD_MB and audio/video to MAX_MEDIA_MB', async () => {
    const bigPicture = Buffer.concat([PNG, Buffer.alloc(1.5 * MB)]);
    const p = await put('big.png', bigPicture, 'image/png');
    assert.equal(p.status, 413, JSON.stringify(p.data));
    const a = await put('long.wav', wav(1.5 * MB), 'audio/wav');
    assert.equal(a.status, 200, 'audio above the picture limit is fine');
    const tooLong = await put('too-long.wav', wav(2.5 * MB), 'audio/wav');
    assert.equal(tooLong.status, 413, 'audio above MAX_MEDIA_MB is refused');
    const listed = (await me.get('/api/v1/assets')).data.names;
    assert.ok(listed.includes('long.wav'));
    assert.ok(!listed.includes('too-long.wav') && !listed.includes('big.png'));
  });

  it('still counts audio and video against the storage quota', async () => {
    const q = await me.patch(`/api/v1/admin/users/${myId}`, { quotaBytes: 1.7 * MB });
    assert.equal(q.status, 200, JSON.stringify(q.data));
    const over = await put('another.wav', wav(0.5 * MB), 'audio/wav');
    assert.equal(over.status, 413);
    assert.equal(over.data.error.code, 'quota_exceeded');
    assert.equal((await me.patch(`/api/v1/admin/users/${myId}`, { quotaBytes: null })).status, 200);
    assert.equal((await put('another.wav', wav(0.5 * MB), 'audio/wav')).status, 200);
  });
});

describe('seeking (HTTP Range)', () => {
  const body = wav(1000 - 44);
  const get = (headers) => me.req('GET', '/api/v1/assets/seek.wav', undefined, headers);

  before(async () => {
    assert.equal((await put('seek.wav', body, 'audio/wav')).status, 200);
  });

  it('sends the whole file with Accept-Ranges and the security headers', async () => {
    const r = await get({});
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('accept-ranges'), 'bytes');
    assert.equal(r.headers.get('content-length'), '1000');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('content-security-policy'), /sandbox/);
    assert.deepEqual(r.data, body);
  });

  it('sends a part with 206 Partial Content', async () => {
    const r = await get({ range: 'bytes=100-199' });
    assert.equal(r.status, 206);
    assert.equal(r.headers.get('content-range'), 'bytes 100-199/1000');
    assert.equal(r.headers.get('content-length'), '100');
    assert.equal(r.headers.get('content-type'), 'audio/wav');
    assert.match(r.headers.get('content-security-policy'), /sandbox/);
    assert.deepEqual(r.data, body.subarray(100, 200));

    const open = await get({ range: 'bytes=990-' });
    assert.equal(open.status, 206);
    assert.equal(open.headers.get('content-range'), 'bytes 990-999/1000');
    assert.deepEqual(open.data, body.subarray(990));

    const suffix = await get({ range: 'bytes=-5' });
    assert.equal(suffix.status, 206);
    assert.equal(suffix.headers.get('content-range'), 'bytes 995-999/1000');
    assert.deepEqual(suffix.data, body.subarray(995));

    const past = await get({ range: 'bytes=900-5000' });
    assert.equal(past.status, 206, 'an end past the file is cut to the file');
    assert.equal(past.headers.get('content-range'), 'bytes 900-999/1000');
    assert.equal(past.data.length, 100);

    const first = await get({ range: 'bytes=0-0' });
    assert.equal(first.status, 206);
    assert.deepEqual(first.data, body.subarray(0, 1));
  });

  it('answers 416 for a range outside the file', async () => {
    const r = await get({ range: 'bytes=1000-' });
    assert.equal(r.status, 416);
    assert.equal(r.headers.get('content-range'), 'bytes */1000');
    assert.equal((await get({ range: 'bytes=5000-6000' })).status, 416);
    assert.equal((await get({ range: 'bytes=-0' })).status, 416);
  });

  it('ignores ranges it does not understand and stale If-Range', async () => {
    for (const range of ['bytes=0-1,5-6', 'items=0-5', 'bytes=50-10', 'bytes=abc']) {
      const r = await get({ range });
      assert.equal(r.status, 200, range);
      assert.equal(r.data.length, 1000, range);
    }
    const etag = (await get({})).headers.get('etag');
    assert.equal((await get({ range: 'bytes=0-9', 'if-range': etag })).status, 206);
    assert.equal((await get({ range: 'bytes=0-9', 'if-range': '"old"' })).status, 200);
  });

  it('keeps files private', async () => {
    const anon = client(srv.base);
    assert.equal((await anon.req('GET', '/api/v1/assets/seek.wav', undefined, { range: 'bytes=0-9' })).status, 401);
    assert.equal((await me.req('GET', '/api/v1/assets/nothing.wav', undefined, { range: 'bytes=0-9' })).status, 404);
  });
});

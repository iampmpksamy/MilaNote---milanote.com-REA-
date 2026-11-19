import { claimPlayback, domainOf, extensionFor, formatTime, parseVideoLink, parseWebUrl, pickRecordingType, titleFromFileName, voiceNoteTitle } from './media';

describe('media helpers', () => {
  it('formats times', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(5.9)).toBe('0:05');
    expect(formatTime(75.4)).toBe('1:15');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(formatTime(Infinity)).toBe('0:00');
    expect(formatTime(NaN)).toBe('0:00');
  });

  it('makes titles and extensions from files', () => {
    expect(titleFromFileName('Interview take 2.final.mp3')).toBe('Interview take 2.final');
    expect(titleFromFileName('C:\\music\\song.flac')).toBe('song');
    expect(titleFromFileName('.hidden')).toBe('.hidden');
    expect(extensionFor('clip.MOV', 'video/quicktime')).toBe('mov');
    expect(extensionFor('', 'audio/webm;codecs=opus')).toBe('webm');
    expect(extensionFor('blob', 'audio/mp4')).toBe('m4a');
    expect(extensionFor('', 'application/x-unknown')).toBe('bin');
    expect(voiceNoteTitle(new Date(2026, 10, 20, 14, 5))).toMatch(/^Voice note .*20.*/);
  });

  it('picks the first recording format the browser supports', () => {
    expect(pickRecordingType((t) => t === 'audio/mp4')).toBe('audio/mp4');
    expect(pickRecordingType(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickRecordingType(() => false)).toBeNull();
    expect(
      pickRecordingType((t) => {
        if (t.startsWith('audio/webm')) throw new Error('unknown');
        return t === 'audio/ogg';
      }),
    ).toBe('audio/ogg');
  });

  it('pauses the other player when one starts', () => {
    const a = { paused: false, pause: vi.fn() } as unknown as HTMLMediaElement;
    const b = { paused: false, pause: vi.fn() } as unknown as HTMLMediaElement;
    claimPlayback(a);
    claimPlayback(b);
    expect(a.pause).toHaveBeenCalledTimes(1);
    expect(b.pause).not.toHaveBeenCalled();
  });

  it('recognises YouTube links', () => {
    const id = 'dQw4w9WgXcQ';
    for (const u of [
      `https://www.youtube.com/watch?v=${id}`,
      `youtube.com/watch?v=${id}&list=PL123`,
      `https://m.youtube.com/watch?feature=share&v=${id}`,
      `https://youtu.be/${id}`,
      `https://youtube.com/shorts/${id}?si=abc`,
      `https://www.youtube.com/live/${id}`,
      `https://www.youtube-nocookie.com/embed/${id}`,
      `https://music.youtube.com/watch?v=${id}`,
    ]) {
      const v = parseVideoLink(u);
      expect(v?.provider, u).toBe('YouTube');
      expect(v?.id, u).toBe(id);
      expect(v?.embed.startsWith(`https://www.youtube-nocookie.com/embed/${id}?`), u).toBe(true);
    }
    expect(parseVideoLink(`https://youtu.be/${id}?t=1m30s`)?.embed).toContain('start=90');
    expect(parseVideoLink(`https://www.youtube.com/watch?v=${id}&t=42`)?.embed).toContain('start=42');
  });

  it('recognises Vimeo links', () => {
    expect(parseVideoLink('https://vimeo.com/76979871')).toEqual({ provider: 'Vimeo', id: '76979871', embed: 'https://player.vimeo.com/video/76979871?autoplay=1&dnt=1' });
    expect(parseVideoLink('https://vimeo.com/channels/staffpicks/76979871')?.id).toBe('76979871');
    expect(parseVideoLink('https://player.vimeo.com/video/76979871')?.id).toBe('76979871');
    expect(parseVideoLink('https://vimeo.com/76979871/a1b2c3d4e5')?.embed).toContain('h=a1b2c3d4e5');
  });

  it('does not embed anything else', () => {
    for (const u of [
      '',
      'not a link',
      'javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ',
      'https://evil.example/watch?v=dQw4w9WgXcQ',
      'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=short',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ"><script>',
      'https://vimeo.com/about',
      'ftp://vimeo.com/123',
    ]) expect(parseVideoLink(u), u).toBeNull();
  });

  it('reads plain web addresses', () => {
    expect(parseWebUrl('example.com/a')?.href).toBe('https://example.com/a');
    expect(parseWebUrl('javascript:alert(1)')).toBeNull();
    expect(parseWebUrl('abc')).toBeNull();
    expect(parseWebUrl('http://localhost:8080/v.mp4')?.host).toBe('localhost:8080');
    expect(domainOf('https://www.example.com/x?y')).toBe('example.com');
    expect(domainOf('nope nope')).toBe('');
  });
});

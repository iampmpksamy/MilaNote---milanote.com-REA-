import { applyChange, excerpt, insertLink, renderDocument, toggleBlock, toggleWrap, wordCount, wordLabel } from './format';

/** Runs a change and shows the selection as [ ] in the result. */
function run(text: string, sel: [number, number], f: (t: string, s: number, e: number) => ReturnType<typeof toggleWrap> | null): string {
  const c = f(text, sel[0], sel[1]);
  if (!c) return 'null';
  const out = applyChange(text, c);
  return out.slice(0, c.selStart) + '[' + out.slice(c.selStart, c.selEnd) + ']' + out.slice(c.selEnd);
}
const at = (text: string, part: string): [number, number] => [text.indexOf(part), text.indexOf(part) + part.length];

describe('document formatting', () => {
  it('wraps and unwraps bold, italic and strike', () => {
    expect(run('a word here', at('a word here', 'word'), (t, s, e) => toggleWrap(t, s, e, '**'))).toBe('a [**word**] here');
    expect(run('a **word** here', at('a **word** here', 'word'), (t, s, e) => toggleWrap(t, s, e, '**'))).toBe('a [word] here');
    expect(run('a **word** here', at('a **word** here', '**word**'), (t, s, e) => toggleWrap(t, s, e, '**'))).toBe('a [word] here');
    expect(run('x ~~gone~~', at('x ~~gone~~', 'gone'), (t, s, e) => toggleWrap(t, s, e, '~~'))).toBe('x [gone]');
    // Italic inside bold adds a mark instead of eating half of the bold one.
    expect(run('**bold**', at('**bold**', 'bold'), (t, s, e) => toggleWrap(t, s, e, '*'))).toBe('**[*bold*]**');
    expect(run('***both***', at('***both***', 'both'), (t, s, e) => toggleWrap(t, s, e, '*'))).toBe('**[both]**');
  });

  it('keeps spaces outside the marks and marks lines one by one', () => {
    expect(run('say hello ', [4, 10], (t, s, e) => toggleWrap(t, s, e, '*'))).toBe('say [*hello* ]');
    expect(run('one\ntwo', [0, 7], (t, s, e) => toggleWrap(t, s, e, '**'))).toBe('[**one**\n**two**]');
    expect(run('**one**\n**two**', [0, 15], (t, s, e) => toggleWrap(t, s, e, '**'))).toBe('[one\ntwo]');
  });

  it('inserts an empty pair at the cursor', () => {
    expect(run('ab', [1, 1], (t, s, e) => toggleWrap(t, s, e, '**'))).toBe('a**[]**b');
  });

  it('adds, swaps and removes line markers', () => {
    expect(run('Title', [2, 2], (t, s, e) => toggleBlock(t, s, e, 'h1'))).toBe('# Ti[]tle');
    expect(run('# Title', [4, 4], (t, s, e) => toggleBlock(t, s, e, 'h1'))).toBe('Ti[]tle');
    expect(run('# Title', [4, 4], (t, s, e) => toggleBlock(t, s, e, 'h2'))).toBe('## Ti[]tle');
    expect(run('- item', [3, 3], (t, s, e) => toggleBlock(t, s, e, 'quote'))).toBe('> i[]tem');
    expect(run('a\n\nb\nc', [0, 6], (t, s, e) => toggleBlock(t, s, e, 'number'))).toBe('[1. a\n\n2. b\n3. c]');
    expect(run('1. a\n2. b', [0, 9], (t, s, e) => toggleBlock(t, s, e, 'number'))).toBe('[a\nb]');
    expect(run('a\nb\nc', [2, 3], (t, s, e) => toggleBlock(t, s, e, 'bullet'))).toBe('a\n- [b]\nc');
    // A selection ending at the start of the next line leaves that line alone.
    expect(run('a\nb', [0, 2], (t, s, e) => toggleBlock(t, s, e, 'bullet'))).toBe('- [a]\nb');
  });

  it('makes links out of addresses and text', () => {
    expect(run('see example.com', at('see example.com', 'example.com'), insertLink)).toBe('see [https://example.com]');
    expect(run('our site', [0, 8], insertLink)).toBe('our site https://[]');
    expect(run('go', [2, 2], insertLink)).toBe('go https://[]');
    expect(run('https://a.org', [0, 13], insertLink)).toBe('null');
  });

  it('counts words without the marks', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount('# Title\n- **one** two\n1. three — four\n> five')).toBe(6);
    expect(wordLabel(1)).toBe('1 word');
    expect(wordLabel(1200)).toMatch(/^1.?200 words$/);
  });

  it('makes a plain excerpt', () => {
    expect(excerpt('# Plan\n\n- **Bold** and *it* and ~~old~~\n> said')).toBe('Plan Bold and it and old said');
    expect(excerpt('x'.repeat(50), 10)).toBe('xxxxxxxxxx…');
  });

  it('previews with numbered lists and stays escaped', () => {
    const html = renderDocument('# Doc\n1. one\n2. **two**\n\n3. three\nText <b>x</b>');
    expect(html).toContain('<h1>Doc</h1>');
    expect(html).toContain('<ol><li>one</li><li><strong>two</strong></li></ol>');
    expect(html).toContain('<ol start="3"><li>three</li></ol>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(renderDocument('1. <script>alert(1)</script>')).toBe('<ol><li>&lt;script&gt;alert(1)&lt;/script&gt;</li></ol>');
  });
});

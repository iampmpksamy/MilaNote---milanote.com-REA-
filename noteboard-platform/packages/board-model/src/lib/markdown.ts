/**
 * The light formatting used in notes (same rules as the desktop app):
 * `# `, `## `, `### ` headings, `- ` bullets, `> ` quotes, **bold**, *italic*, __underline__,
 * ~~strike~~, `code`, and web addresses shown as links.
 *
 * Output is built from escaped text only, so a note can never inject markup or scripts.
 */

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/g;

function inline(escaped: string): string {
  let out = escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<u>$1</u>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(URL_RE, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  return out;
}

export function renderNote(text: string): string {
  const lines = text.split('\n');
  const html: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) html.push(`<ul>${list.join('')}</ul>`);
    list = [];
  };
  for (const raw of lines) {
    const line = escapeHtml(raw);
    let m: RegExpMatchArray | null;
    if ((m = raw.match(/^(#{1,3}) (.*)$/))) {
      flush();
      const level = m[1].length;
      html.push(`<h${level}>${inline(escapeHtml(m[2]))}</h${level}>`);
    } else if ((m = raw.match(/^[-*] (.*)$/))) {
      list.push(`<li>${inline(escapeHtml(m[1]))}</li>`);
    } else if ((m = raw.match(/^> (.*)$/))) {
      flush();
      html.push(`<blockquote>${inline(escapeHtml(m[1]))}</blockquote>`);
    } else if (raw.trim() === '') {
      flush();
      html.push('<p class="gap"></p>');
    } else {
      flush();
      html.push(`<p>${inline(line)}</p>`);
    }
  }
  flush();
  return html.join('');
}

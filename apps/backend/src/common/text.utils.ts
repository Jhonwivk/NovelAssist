// 正文文本处理工具（章节内容以 TipTap/ProseMirror HTML 存储）

export function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** 字数统计：中文按字符计，去掉所有空白与标签。 */
export function countWords(htmlOrText: string): number {
  const text = stripHtml(htmlOrText ?? '');
  return text.replace(/\s+/g, '').length;
}

/** HTML 正文 → 段落纯文本（导出用）。 */
export function htmlToParagraphs(html: string): string[] {
  if (!html) return [];
  return stripHtml(html)
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** 纯文本（AI 生成）→ 章节 HTML（按段落包 <p>，转义）。 */
export function paragraphsToHtml(text: string): string {
  if (!text) return '';
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
    .join('');
}

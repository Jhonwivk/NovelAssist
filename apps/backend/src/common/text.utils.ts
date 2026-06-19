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

/** HTML 正文 → 段落纯文本（导出用）。先把块级标签转成换行，避免段落被并成一段。 */
export function htmlToParagraphs(html: string): string[] {
  if (!html) return [];
  const withBreaks = html
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
  return stripHtml(withBreaks)
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** 字符二元语法集合（去 HTML/空白）。 */
function bigrams(s: string): Set<string> {
  const clean = stripHtml(s ?? '').replace(/\s+/g, '');
  const set = new Set<string>();
  for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2));
  return set;
}

/** 字符二元语法 Jaccard 相似度（0-1）。用于长度相近文本（如两章摘要）的重叠检测。 */
export function bigramSimilarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

/** 二元语法包含度（0-1）：`probe` 的二元语法有多少被 `corpus` 覆盖。
 *  用于"短文本是否已被长文本涵盖"（如：某条章节计划是否重复了已写章节）。 */
export function bigramContainment(probe: string, corpus: string): number {
  const P = bigrams(probe);
  const C = bigrams(corpus);
  if (P.size === 0 || C.size === 0) return 0;
  let inter = 0;
  for (const g of P) if (C.has(g)) inter++;
  return inter / P.size;
}

/** 纯文本（AI 生成）→ 章节 HTML（按段落包 <p>，转义）。 */
export function paragraphsToHtml(text: string): string {
  if (!text) return '';
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    // 去掉模型偶发输出的 markdown 残留：代码围栏行、标题行（章节标题另有字段）
    .filter((p) => p && !/^```/.test(p) && !/^#{1,6}\s/.test(p))
    .map((p) => p.replace(/^\*\*(.+?)\*\*$/, '$1').trim()) // 整行加粗 → 纯文本
    .filter(Boolean)
    .map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
    .join('');
}

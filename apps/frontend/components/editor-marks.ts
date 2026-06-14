import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * 内联一致性标记（plan UI §5.3）。
 * 把本章 ConsistencyIssue 的 evidence（原文片段）匹配到正文，渲染波浪下划线：
 *   高危红、中等黄；伏笔关键词蓝色虚线。hover 显示提示（title 属性原生 tooltip）。
 * 仅匹配能在正文中找到的原文片段（L4 引用原文效果最好）。
 */
export const issueMarksKey = new PluginKey('issueMarks');

interface MarkData {
  issues: { evidence?: string; severity?: string; type?: string; suggestion?: string }[];
  foreshadows: { title?: string; status?: string }[];
  v: number;
}

export const IssueMarks = Extension.create({
  name: 'issueMarks',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: issueMarksKey,
        state: {
          init: (): MarkData => ({ issues: [], foreshadows: [], v: 0 }),
          apply(tr, value: MarkData) {
            const meta = tr.getMeta(issueMarksKey) as MarkData | undefined;
            return meta ?? value;
          },
        },
        props: {
          decorations(state) {
            const data = issueMarksKey.getState(state) as MarkData | undefined;
            if (!data) return DecorationSet.empty;
            const { text, posAt } = buildPosMap(state);
            if (posAt.length === 0) return DecorationSet.empty;
            const decos: Decoration[] = [];
            const addRange = (needle: string, cls: string, tip: string) => {
              if (!needle || needle.length < 3) return;
              let idx = text.indexOf(needle);
              let guard = 0;
              while (idx !== -1 && guard++ < 16) {
                const from = posAt[idx];
                const to = posAt[idx + needle.length - 1] + 1;
                if (from != null && to != null && to > from) {
                  decos.push(Decoration.inline(from, to, { class: cls, title: tip }));
                }
                idx = text.indexOf(needle, idx + needle.length);
              }
            };
            for (const is of data.issues) {
              const cls = is.severity === 'high' ? 'mark-issue-high' : 'mark-issue-medium';
              addRange(is.evidence ?? '', cls, `⚠ ${is.type}${is.suggestion ? '：' + is.suggestion : ''}`);
            }
            for (const f of data.foreshadows) {
              addRange(f.title ?? '', 'mark-foreshadow', `🔥 伏笔：${f.title}（${f.status === 'paid_off' ? '已回收' : '待回收'}）`);
            }
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});

function buildPosMap(state: any): { text: string; posAt: number[] } {
  const posAt: number[] = [];
  const parts: string[] = [];
  state.doc.descendants((node: any, pos: number) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) posAt.push(pos + i);
      parts.push(node.text);
    }
    return true;
  });
  return { text: parts.join(''), posAt };
}

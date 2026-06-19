'use client';

import { AlignLeft, BarChart3, BookOpen, Bot, Lightbulb, ListOrdered, Network, Sparkles, LucideIcon } from 'lucide-react';
import { NavItem } from './ui';

export type WorkbenchTab =
  | 'chapters' | 'outline' | 'idea'
  | 'bible'
  | 'consistency' | 'insight'
  | 'chat' | 'cost';

type Leaf = { key: WorkbenchTab; label: string; icon: LucideIcon };
type Group = { title: string; leaves: Leaf[] };

const GROUPS: Group[] = [
  { title: '创作', leaves: [
    { key: 'chapters', label: '章节', icon: ListOrdered },
    { key: 'outline', label: '大纲', icon: AlignLeft },
    { key: 'idea', label: '灵感', icon: Lightbulb },
  ]},
  { title: '设定', leaves: [
    { key: 'bible', label: '设定库', icon: BookOpen },
  ]},
  { title: '洞察', leaves: [
    { key: 'consistency', label: '一致性', icon: Sparkles },
    { key: 'insight', label: '知识图谱', icon: Network },
  ]},
  { title: '工具', leaves: [
    { key: 'chat', label: 'AI 助手', icon: Bot },
    { key: 'cost', label: '成本', icon: BarChart3 },
  ]},
];

export function WorkbenchNav({ tab, setTab, chapterCount, issueCount }: { tab: WorkbenchTab; setTab: (t: WorkbenchTab) => void; chapterCount?: number; issueCount?: number }) {
  return (
    <nav className="space-y-3">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <div className="px-2.5 pb-1 text-overline">{g.title}</div>
          <div className="space-y-0.5">
            {g.leaves.map((l) => (
              <NavItem
                key={l.key}
                active={tab === l.key}
                icon={l.icon}
                label={l.label}
                onClick={() => setTab(l.key)}
                count={l.key === 'chapters' ? chapterCount : l.key === 'consistency' ? issueCount : undefined}
              />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

/** 旧版 12 个 tab key → 新版（设定/物品/地点 合并；关系图/时间线/伏笔 合并）。 */
export function mapLegacyTab(raw: string | null): WorkbenchTab {
  switch (raw) {
    case 'chapters': return 'chapters';
    case 'outline': return 'outline';
    case 'idea': return 'idea';
    case 'bible': case 'items': case 'locations': return 'bible';
    case 'consistency': return 'consistency';
    case 'graph': case 'timeline': case 'foreshadow': return 'insight';
    case 'chat': return 'chat';
    case 'cost': return 'cost';
    default: return 'chapters';
  }
}

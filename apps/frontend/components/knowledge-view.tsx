'use client';

import { useState } from 'react';
import { SegmentedControl } from './ui';
import { RelationshipGraph, TimelineView } from './visualization';
import { ForeshadowPanel } from './workbench-panels';

type Facet = 'graph' | 'timeline' | 'foreshadow';

/**
 * 知识图谱：统一浏览 L1 抽取产生的 知识层——关系图 / 时间线 / 伏笔。
 * 取代原来分散的 关系图/时间线/伏笔 三个 tab。三者都依赖一致性抽取数据。
 * 条件渲染 → RelationshipGraph 每次切面整体 remount，G6 懒加载与主题 MutationObserver 正常重跑。
 */
export function KnowledgeView({ novelId }: { novelId: number }) {
  const [facet, setFacet] = useState<Facet>('graph');
  return (
    <section className="space-y-4">
      <SegmentedControl<Facet>
        size="sm"
        value={facet}
        onChange={setFacet}
        options={[
          { value: 'graph', label: '关系图' },
          { value: 'timeline', label: '时间线' },
          { value: 'foreshadow', label: '伏笔' },
        ]}
      />
      {facet === 'graph' && <RelationshipGraph novelId={novelId} />}
      {facet === 'timeline' && <TimelineView novelId={novelId} />}
      {facet === 'foreshadow' && <ForeshadowPanel novelId={novelId} />}
    </section>
  );
}

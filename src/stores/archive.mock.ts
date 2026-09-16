// 已归档对话(mock):对应后端 session.set_hidden / 归档相关 RPC。
// 归档 = 从侧栏主列表收起,但会话本体与记录保留,可随时恢复。

export interface ArchivedRow {
  id: string
  title: string
  project: string
  platform: string
  /** 归档时间 */
  archivedAt: string
  /** 归档前的最后活动时间 */
  lastActive: string
  messageCount: number
}

export const archived: ArchivedRow[] = [
  {
    id: 'old-model-eval',
    title: '旧模型评测对比',
    project: '研究',
    platform: '桌面',
    archivedAt: '上周',
    lastActive: '8 月 21 日',
    messageCount: 46,
  },
  {
    id: 'design-explore',
    title: '桌面端视觉方向探索',
    project: '新客户端',
    platform: '桌面',
    archivedAt: '两周前',
    lastActive: '8 月 14 日',
    messageCount: 88,
  },
  {
    id: 'vendor-quote',
    title: '供应商报价核对',
    project: '未分类',
    platform: '微信',
    archivedAt: '三周前',
    lastActive: '8 月 6 日',
    messageCount: 12,
  },
  {
    id: 'perf-spike',
    title: '长会话渲染性能验证',
    project: '新客户端',
    platform: 'Slack',
    archivedAt: '一个月前',
    lastActive: '7 月 29 日',
    messageCount: 31,
  },
]

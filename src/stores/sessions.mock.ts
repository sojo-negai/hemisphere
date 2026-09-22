// 会话与项目的夹具数据:只服务开发期的浏览器预览(?preview=1)。
// 真实数据由 stores/sessions.ts 从内核拉取(session.list / projects.*),这里不再参与。

import type { ProjectRow, SessionStatus } from './sessions'

interface FixtureSession {
  id: string
  title: string
  time: string
  project: string
  platform: string
  status: SessionStatus
}

export const fixtures: FixtureSession[] = [
  { id: 'architecture', title: '梳理新客户端的信息架构', time: '刚刚', project: '新客户端', platform: '桌面', status: 'ok' },
  { id: 'gateway', title: 'Gateway 事件如何归并', time: '今天', project: '新客户端', platform: 'Slack', status: 'confirm' },
  { id: 'tauri', title: 'Tauri 2 的窗口通信方案', time: '昨天', project: '新客户端', platform: '桌面', status: 'ok' },
  { id: 'release', title: '准备首个可用版本', time: '周一', project: '新客户端', platform: '桌面', status: 'error' },
  { id: 'pricing', title: '定价页信息层级拆解', time: '周一', project: '官网对标', platform: 'Slack', status: 'none' },
  { id: 'landing', title: '竞品首屏话术梳理', time: '上周', project: '官网对标', platform: 'Discord', status: 'ok' },
  { id: 'rag', title: 'RAG 检索链路补全', time: '上周', project: '研究', platform: 'Telegram', status: 'confirm' },
  { id: 'vector', title: '向量库评测脚本', time: '上周', project: '研究', platform: '桌面', status: 'none' },
  { id: 'changelog', title: '本周发布说明草稿', time: '两天前', project: '研究', platform: '微信', status: 'error' },
  { id: 'meeting', title: '会议纪要 → 任务拆分', time: '三天前', project: '未分类', platform: '微信', status: 'ok' },
]

export const fixtureProjects: ProjectRow[] = [
  { id: 'p-newclient', name: '新客户端', sessionCount: 4, auto: false, noProject: false },
  { id: 'p-landing', name: '官网对标', sessionCount: 2, auto: true, noProject: false },
  { id: 'p-research', name: '研究', sessionCount: 3, auto: false, noProject: false },
  { id: 'p-none', name: '未分类', sessionCount: 1, auto: false, noProject: true },
]

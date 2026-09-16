// 会话列表(mock):接入真实后端前,先用假数据把界面跑通。
// 接真数据时把 sessions 换成 stores/connection.ts 拉取的 session.list 结果即可。

/**
 * 会话状态:决定卡片右下角指示灯的颜色与语义。
 * 三态,与真实运行结果一一对应:
 *   error   红灯 —— 上一轮出错
 *   confirm 黄灯 —— 等待用户确认(工具授权等)
 *   ok      绿灯 —— 正常返回
 */
export type SessionStatus = 'ok' | 'confirm' | 'error'

export const STATUS_LABEL: Record<SessionStatus, string> = {
  ok: '正常返回',
  confirm: '需要确认',
  error: '出错',
}

export interface SessionRow {
  id: string
  title: string
  /** 所属项目:卡片上作为“特性”展示 */
  project: string
  /** 来源平台:桌面 / Slack / 微信 / Telegram … */
  platform: string
  time: string
  status: SessionStatus
}

export const sessions: SessionRow[] = [
  { id: 'architecture', title: '梳理新客户端的信息架构', project: '新客户端', platform: '桌面', time: '刚刚', status: 'ok' },
  { id: 'gateway', title: 'Gateway 事件如何归并', project: '新客户端', platform: 'Slack', time: '今天', status: 'confirm' },
  { id: 'tauri', title: 'Tauri 2 的窗口通信方案', project: '新客户端', platform: '桌面', time: '昨天', status: 'ok' },
  { id: 'release', title: '准备首个可用版本', project: '新客户端', platform: '桌面', time: '周一', status: 'error' },
  { id: 'pricing', title: '定价页信息层级拆解', project: '官网对标', platform: 'Slack', time: '周一', status: 'ok' },
  { id: 'landing', title: '竞品首屏话术梳理', project: '官网对标', platform: 'Discord', time: '上周', status: 'ok' },
  { id: 'rag', title: 'RAG 检索链路补全', project: '研究', platform: 'Telegram', time: '上周', status: 'confirm' },
  { id: 'vector', title: '向量库评测脚本', project: '研究', platform: '桌面', time: '上周', status: 'ok' },
  { id: 'changelog', title: '本周发布说明草稿', project: '研究', platform: '微信', time: '两天前', status: 'error' },
  { id: 'meeting', title: '会议纪要 → 任务拆分', project: '未分类', platform: '微信', time: '三天前', status: 'ok' },
]

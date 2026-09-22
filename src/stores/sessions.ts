// 会话与项目:数据来自 hermes 内核(session.list / session.active_list / projects.*)。
//
// 三条数据来源,合成侧栏需要的一份视图:
//   1. session.list     → 历史会话(标题/预览/时间/消息数/source)
//   2. session.active_list → 本进程活着的会话及其实时状态(LiveSessionStatus)
//   3. projects.tree + projects.project_sessions → 会话归属哪个项目
//
// 状态灯语义(三色 + 静默):黄=需要你动作,红=出错,绿=正常返回,灰=无实时状态。
// 内核只提供「实时状态」,不存「上次结果」,所以红/绿由客户端按事件自己记(见 noteEvent)。

import { reactive, ref } from 'vue'
import type { GatewayEvent } from '../lib/gateway-client'
import { isPreview } from '../lib/preview'
import { gateway } from './connection'
import { fixtures, fixtureProjects } from './sessions.mock'

// ── 类型(与 UI 的契约)────────────────────────────────

/** 状态灯语义。none = 该会话没有可用的实时信号(多为历史会话) */
export type SessionStatus = 'ok' | 'confirm' | 'error' | 'none'

export const STATUS_LABEL: Record<SessionStatus, string> = {
  ok: '正常返回',
  confirm: '需要用户确认',
  error: '出错',
  none: '无实时状态',
}

export interface SessionRow {
  /** 存储 id */
  id: string
  /** 运行 id:仅当内核里还活着时存在(session.active_list) */
  liveId?: string
  title: string
  preview: string
  /** 相对时间(列表展示) */
  time: string
  startedAt: number
  messageCount: number
  /** 内核给的原始来源:desktop / acp / telegram … */
  source: string
  /** 来源显示名(侧栏「平台」维度) */
  platform: string
  /** 所属项目名(侧栏「项目」维度) */
  project: string
  status: SessionStatus
  /** 内核里是否活着:决定状态灯是否呼吸 */
  live: boolean
}

export interface ProjectRow {
  id: string
  name: string
  color?: string | null
  icon?: string | null
  sessionCount: number
  /** 自动识别(git 根)或「未归档」桶,展示时区分对待 */
  auto: boolean
  noProject: boolean
}

// ── 响应式状态 ────────────────────────────────────────

export const sessions = ref<SessionRow[]>([])

/** 侧栏当前选中的会话(存储 id):对话视图据此拉历史,两处共用一个来源 */
export const selectedId = ref('')
export const projects = ref<ProjectRow[]>([])
export const sessionsLoading = ref(false)
export const sessionsError = ref('')

/** 客户端自记的每会话结果(内核不存):本轮出错 / 本轮正常结束 */
const remembered = reactive<Record<string, SessionStatus>>({})

// ── 契约里的线格式(字段名以 tui_gateway/contracts/sessions.py 为准)──

interface WireSessionRow {
  id: string
  resolved_id?: string | null
  title?: string
  preview?: string
  started_at?: number
  message_count?: number
  source?: string
}

interface WireActiveItem {
  id: string
  session_key?: string
  title?: string
  status?: string
  started_at?: number
  last_active?: number
  message_count?: number
}

interface WireProjectNode {
  id: string
  label: string
  /** 项目主目录;label 不像人话时用它兜底命名 */
  path?: string | null
  color?: string | null
  icon?: string | null
  isAuto?: boolean
  isNoProject?: boolean
  sessionCount?: number
  /** 项目下的会话(与 session.list 同一套 id),用于建立「会话 → 项目」归属 */
  previewSessions?: { id?: string; title?: string }[]
}

// ── 展示层映射 ────────────────────────────────────────

/** source → 平台显示名;未知来源原样显示 */
const SOURCE_LABEL: Record<string, string> = {
  desktop: '桌面',
  acp: 'ACP',
  cli: '终端',
  tui: '终端',
  telegram: 'Telegram',
  wechat: '微信',
  slack: 'Slack',
  discord: 'Discord',
  feishu: '飞书',
  dingtalk: '钉钉',
}

export function sourceLabel(source: string): string {
  if (!source) return '未知来源'
  return SOURCE_LABEL[source.toLowerCase()] ?? source
}

/** 相对时间:刚刚 / N 分钟前 / 今天 HH:mm / 昨天 / 周X / M 月 D 日 */
export function relativeTime(seconds: number): string {
  if (!seconds) return ''
  const then = new Date(seconds * 1000)
  const now = new Date()
  const diff = (now.getTime() - then.getTime()) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  const sameDay = then.toDateString() === now.toDateString()
  if (sameDay) return `今天 ${String(then.getHours()).padStart(2, '0')}:${String(then.getMinutes()).padStart(2, '0')}`
  const yesterday = new Date(now.getTime() - 86400_000)
  if (then.toDateString() === yesterday.toDateString()) return '昨天'
  if (diff < 7 * 86400) return `周${'日一二三四五六'[then.getDay()]}`
  return `${then.getMonth() + 1} 月 ${then.getDate()} 日`
}

/** 内核实时状态 → 状态灯。waiting 是唯一「在等你」的状态,与黄灯语义对齐 */
function statusFromLive(live: string | undefined): SessionStatus {
  if (live === 'waiting') return 'confirm'
  return 'none'
}

// ── 拉取 ─────────────────────────────────────────────

/**
 * 后端给的 label 不保证是人话:按文件夹自动识别的项目会把文件夹名直接当 label,
 * 而 agent 的工作区目录名常常就是一串 UUID,原样显示会变成「ACP · 5ccf5fdb-…」。
 * 所以显示前洗一遍:label 像 id 就退到 path 的最后一段,path 也像 id 才认输。
 */
const ID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-|^[0-9a-f]{20,}$/i

function tidyProjectName(label?: string | null, path?: string | null): string {
  const l = (label ?? '').trim()
  if (l && !ID_LIKE.test(l)) return l
  const base = (path ?? '').replace(/[\/]+$/, '').split(/[\/]/).pop() ?? ''
  if (base && !ID_LIKE.test(base)) return base
  return '(未命名项目)'
}

/** 会话 → 项目 的归属表(sessionId → 项目名),由 projects.* 填充 */
let projectOf = new Map<string, string>()

/** 拉历史会话 + 实时状态,合成侧栏列表 */
export async function refreshSessions(): Promise<void> {
  if (isPreview) return
  sessionsLoading.value = true
  try {
    const [listed, active] = await Promise.all([
      gateway.request<{ sessions?: WireSessionRow[] }>('session.list', { limit: 200 }, 20_000),
      gateway
        .request<{ sessions?: WireActiveItem[] }>('session.active_list', {}, 20_000)
        .catch(() => ({ sessions: [] as WireActiveItem[] })),
    ])

    // 实时状态索引:运行 id / session_key / 标题 三种键都试,兼容不同内核版本
    const live = new Map<string, WireActiveItem>()
    for (const a of active.sessions ?? []) {
      if (a.id) live.set(a.id, a)
      if (a.session_key) live.set(a.session_key, a)
      if (a.title) live.set(a.title, a)
    }

    sessions.value = (listed.sessions ?? []).map((r) => {
      const hit = live.get(r.id) ?? (r.resolved_id ? live.get(r.resolved_id) : undefined)
      const rememberedStatus = remembered[r.id]
      return {
        id: r.id,
        liveId: hit?.id,
        title: r.title?.trim() || '(无标题)',
        preview: r.preview ?? '',
        time: relativeTime(r.started_at ?? 0),
        startedAt: r.started_at ?? 0,
        messageCount: r.message_count ?? 0,
        source: r.source ?? '',
        platform: sourceLabel(r.source ?? ''),
        project: projectOf.get(r.id) ?? '未分类',
        status: rememberedStatus ?? statusFromLive(hit?.status),
        live: !!hit,
      }
    })
    sessionsError.value = ''
  } catch (e) {
    sessionsError.value = String(e)
  } finally {
    sessionsLoading.value = false
  }
}

/**
 * 拉项目树并建立「会话 → 项目」归属。
 *
 * tree 自带每个项目的 previewSessions(会话 id 与 session.list 同一套 id),先用它建表;
 * 若某项目的会话数多于预览条数,再对该项目单独取完整列表补全。
 * 实测:侧栏「项目」维度只能反映内核里真实存在的项目——没有归属的会话就是「未分类」。
 */
export async function refreshProjects(): Promise<void> {
  if (isPreview) return
  try {
    // session_limit 给足,尽量一次拿全归属关系(避免逐项目再请求)
    const tree = await gateway.request<{ projects?: WireProjectNode[] }>(
      'projects.tree', { session_limit: 200, preview_limit: 5 }, 25_000,
    )
    const nodes = tree.projects ?? []
    projects.value = nodes.map((n) => ({
      id: n.id,
      name: tidyProjectName(n.label, n.path),
      color: n.color,
      icon: n.icon,
      sessionCount: n.sessionCount ?? 0,
      auto: !!n.isAuto,
      noProject: !!n.isNoProject,
    }))

    const map = new Map<string, string>()
    const apply = (label: string, list?: { id?: string }[]) => {
      for (const s of list ?? []) if (s.id) map.set(s.id, label)
    }

    for (const n of nodes) apply(tidyProjectName(n.label, n.path), n.previewSessions)

    // 预览条数不够覆盖该项目全部会话时,再补一次完整列表(最多 6 个项目)
    const needFull = nodes.filter((n) => (n.sessionCount ?? 0) > (n.previewSessions?.length ?? 0))
    for (const n of needFull.slice(0, 6)) {
      try {
        const full = await gateway.request<{
          project?: { previewSessions?: { id?: string }[]; label?: string }
        }>('projects.project_sessions', { project_id: n.id, session_limit: 200 }, 20_000)
        apply(tidyProjectName(full.project?.label ?? n.label, n.path), full.project?.previewSessions)
      } catch {
        // 单个项目失败不影响其余归属;这些会话落到「未分类」
      }
    }
    projectOf = map
  } catch {
    // 项目维度不可用时,侧栏「项目」分组退化为全部未分类
  }
}

/** 首次进入主界面时拉一次全量 */
export async function refreshAll(): Promise<void> {
  if (isPreview) return
  await Promise.all([refreshSessions(), refreshProjects()]).then(() => refreshSessions())
}

// ── 实时事件 → 状态灯 ─────────────────────────────────

/**
 * 事件归并。内核只有「实时状态」,没有「上次结果」,所以红绿由这里自己记:
 * - approval.pending  → 该会话黄灯(等你确认)
 * - error             → 红灯,记进 remembered
 * - message.complete  → 绿灯,记进 remembered
 * - sessions.changed / session.title → 列表需要重新拉
 */
export function noteEvent(e: GatewayEvent): boolean {
  const p = (e.payload ?? {}) as Record<string, unknown>
  const sid = typeof p.session_id === 'string' ? p.session_id : e.session_id
  switch (e.type) {
    case 'approval.pending':
      if (sid) mark(sid, 'confirm')
      return true
    case 'error':
      if (sid) mark(sid, 'error')
      return true
    case 'message.complete':
      if (sid) mark(sid, 'ok')
      return true
    case 'sessions.changed':
    case 'session.title':
      void refreshSessions()
      return true
    default:
      return false
  }
}

function mark(sessionId: string, status: SessionStatus) {
  remembered[sessionId] = status
  const row = sessions.value.find((s) => s.id === sessionId || s.liveId === sessionId)
  if (row) row.status = status
}

// ── 动作(参数形状与 id 解析规则均已实测)──────────────
//
// 内核按用途解析 session_id 的方式不同,实测结论:
//   session.title / session.set_hidden → 先按「运行 id」解析,再退回存储 id / key / 标题
//   session.delete                     → 必须「存储 id」,且会话得已有落库行
// 所以这里统一:改类操作用 liveIdOf(优先运行 id),删除只用存储 id。

/** 改类操作用的 id:有运行 id 就用它 */
function liveIdOf(id: string): string {
  return sessions.value.find((s) => s.id === id)?.liveId ?? id
}

/** 重命名:session.title { session_id, title } */
export async function renameSession(id: string, title: string): Promise<void> {
  await gateway.request('session.title', { session_id: liveIdOf(id), title }, 15_000)
  const row = sessions.value.find((s) => s.id === id)
  if (row) row.title = title
}

/** 归档:session.set_hidden { session_id, hidden } */
export async function archiveSession(id: string): Promise<void> {
  await gateway.request('session.set_hidden', { session_id: liveIdOf(id), hidden: true }, 15_000)
  sessions.value = sessions.value.filter((s) => s.id !== id)
}

/** 删除:session.delete { session_id } —— 存储 id */
export async function deleteSession(id: string): Promise<void> {
  await gateway.request('session.delete', { session_id: id }, 15_000)
  sessions.value = sessions.value.filter((s) => s.id !== id)
}

/** 分支:session.create { parent_session_id } → 返回新会话(运行 id + 存储 id,均已实测) */
export async function branchSession(id: string): Promise<string> {
  const created = await gateway.request<{ session_id?: string; stored_session_id?: string }>(
    'session.create', { parent_session_id: id }, 30_000,
  )
  await refreshSessions()
  return created.session_id ?? created.stored_session_id ?? ''
}

// ── 预览模式:用夹具填充,界面照常可用 ─────────────────

if (isPreview) {
  projects.value = fixtureProjects
  sessions.value = fixtures.map((f) => ({
    id: f.id,
    title: f.title,
    preview: '',
    time: f.time,
    startedAt: 0,
    messageCount: 0,
    source: f.platform,
    platform: f.platform,
    project: f.project,
    status: f.status,
    live: f.status !== 'none',
  }))
}

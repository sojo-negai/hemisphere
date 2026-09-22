// 会话历史与实时流:界面唯一的「这一屏说了什么」来源。
//
// 三条写入路径,都落到同一份 rows:
//   1. openSession()       → session.resume 拉回的历史(归一化)
//   2. sendPrompt()        → 本地乐观插入的用户气泡 + prompt.submit
//   3. noteTranscriptEvent → 内核推来的流式事件(delta / 工具 / 推理 / 回合结束)
//
// 实测的形状(不是猜的):
//   session.resume → LiveSessionSnapshot
//     role 只有 user / assistant / tool
//     user:      { role, text, timestamp, row_id }
//     assistant: { role, text, timestamp, row_id, reasoning?, reasoning_content?, … }
//                text 可能为空(纯思考行),不单独渲染 reasoning 就会出现空白行
//     tool:      { role, name, context, args }   ← args 是 JSON 字符串,不是对象
//     另外给出 status / running / messages_omitted / session_key(存储 id)与**新的运行 id**
//   事件帧:{ jsonrpc, method:'event', params:{ type, session_id, payload } }
//     —— session_id 在 params 里,所以要按会话过滤,否则别的会话的输出会串进来
//
// 身份三件套:storedId(侧栏与删除用)/ runId(prompt.submit 与中断用)/ sessionKey(内核 key)。

import { ref } from 'vue'
import { isPreview } from '../lib/preview'
import type { GatewayEvent } from '../lib/gateway-client'
import { gateway } from './connection'

export type RowKind = 'user' | 'assistant' | 'tool' | 'system'

export interface TranscriptRow {
  /** 稳定 key:历史行用内核 row_id,实时行按类型+序号合成 */
  key: string
  kind: RowKind
  text: string
  time: string
  /** assistant 的推理(纯思考行只有它) */
  reasoning?: string
  /** 实时行:文本还在长 */
  streaming?: boolean
  /** tool:工具名 */
  name?: string
  /** tool:参数摘要 */
  context?: string
  /** tool:原始参数(JSON 字符串) */
  args?: string
  /** tool:配对 tool.start 与 tool.complete 用 */
  toolId?: string
  /** tool:还在跑 */
  running?: boolean
  /** tool:返回文本 */
  result?: string
  /** tool:耗时(秒) */
  duration?: number
}

interface WireMessage {
  role?: string
  text?: string | null
  timestamp?: number | null
  row_id?: number | null
  display_kind?: string | null
  name?: string | null
  context?: string | null
  args?: unknown
  reasoning?: string | null
}

export const rows = ref<TranscriptRow[]>([])
export const loading = ref(false)
export const loadError = ref('')
/** 内核为压缩等原因省略了更早的消息 */
export const omitted = ref(false)
/** 会话实时状态(LiveSessionStatus)与是否正在跑 */
export const liveStatus = ref('')
export const running = ref(false)
/** 本回合是否正在生成(输入区据此在「发送」与「停止」之间切换) */
export const turnActive = ref(false)
/** prompt.submit 的落位方式:streaming / queued / steered / redirected */
export const submitStatus = ref('')

export const storedId = ref('')
export const runId = ref('')
export const sessionKey = ref('')

let seq = 0
const liveKey = (kind: string) => `live-${kind}-${++seq}`

/** 正在被 delta 追加的那条 assistant 行(工具调用与旁白会把它封口) */
let openAssistant = ''

function hhmm(ts?: number | null): string {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function normalize(msgs: WireMessage[]): TranscriptRow[] {
  const out: TranscriptRow[] = []
  msgs.forEach((m, i) => {
    // 内核标记为不显示的行(例如注入的系统提示)不进界面
    if (m.display_kind === 'hidden') return
    const key = m.row_id != null ? `row-${m.row_id}` : `idx-${i}`
    if (m.role === 'tool') {
      const args =
        typeof m.args === 'string' ? m.args : m.args ? JSON.stringify(m.args, null, 1) : ''
      out.push({
        key, kind: 'tool', text: '', time: '',
        name: m.name || '工具', context: m.context || '', args,
      })
      return
    }
    out.push({
      key,
      kind: m.role === 'user' ? 'user' : 'assistant',
      text: (m.text ?? '').trim(),
      time: hhmm(m.timestamp),
      reasoning: (m.reasoning ?? '').trim() || undefined,
    })
  })
  return out
}

/** 打开(附着到)一个存储会话,拉回它的历史 */
export async function openSession(id: string): Promise<void> {
  if (isPreview || !id) return
  loading.value = true
  loadError.value = ''
  try {
    const snap = await gateway.request<{
      session_id?: string
      stored_session_id?: string | null
      session_key?: string | null
      messages?: WireMessage[]
      messages_omitted?: boolean
      status?: string | null
      running?: boolean | null
    }>('session.resume', { session_id: id }, 30_000)

    rows.value = normalize(snap.messages ?? [])
    omitted.value = !!snap.messages_omitted
    liveStatus.value = snap.status ?? ''
    running.value = !!snap.running
    runId.value = snap.session_id ?? ''
    storedId.value = snap.stored_session_id || id
    sessionKey.value = snap.session_key ?? ''
    turnActive.value = !!snap.running
    submitStatus.value = ''
    openAssistant = ''
  } catch (e) {
    rows.value = []
    loadError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

/** 换会话 / 断线时清空 */
export function clearTranscript(): void {
  rows.value = []
  loadError.value = ''
  omitted.value = false
  liveStatus.value = ''
  running.value = false
  turnActive.value = false
  submitStatus.value = ''
  storedId.value = ''
  runId.value = ''
  sessionKey.value = ''
  openAssistant = ''
}

function pushSystem(text: string): void {
  rows.value.push({ key: liveKey('sys'), kind: 'system', text, time: hhmm(Date.now() / 1000) })
}

/** 把正在长的 assistant 行封口(工具调用、旁白、回合结束都要封) */
function sealAssistant(): void {
  if (!openAssistant) return
  const row = rows.value.find((r) => r.key === openAssistant)
  if (row) row.streaming = false
  openAssistant = ''
}

/** 往当前 assistant 行追加文本;没有开着的行就新建一条 */
function appendAssistant(text: string, field: 'text' | 'reasoning'): void {
  if (openAssistant) {
    const row = rows.value.find((r) => r.key === openAssistant)
    if (row) {
      row[field] = (row[field] ?? '') + text
      row.streaming = true
      return
    }
  }
  const row: TranscriptRow = {
    key: liveKey('a'), kind: 'assistant', text: '', time: hhmm(Date.now() / 1000),
    streaming: true,
  }
  row[field] = text
  rows.value.push(row)
  openAssistant = row.key
}

/** 发送一条消息到当前附着的会话 */
export async function sendPrompt(text: string): Promise<void> {
  const t = text.trim()
  if (!t) return
  if (!runId.value) {
    // 附着失败时绝不悄悄 session.create —— 那会在侧栏顶出一个「凭空出现」的对话
    pushSystem(loadError ? `会话未能打开：${loadError}` : '会话还没有打开，稍后再试')
    return
  }
  // 乐观插入:先上屏,不等内核回包
  rows.value.push({ key: liveKey('u'), kind: 'user', text: t, time: hhmm(Date.now() / 1000) })
  turnActive.value = true
  try {
    const res = await gateway.request<{ status?: string }>(
      'prompt.submit', { session_id: runId.value, text: t }, 30_000,
    )
    // queued / steered:文本被排队或被当成插话,不是立刻开始生成
    submitStatus.value = res.status ?? ''
  } catch (e) {
    turnActive.value = false
    pushSystem(`发送失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

/** 中断本回合 */
export async function interruptTurn(): Promise<void> {
  if (!runId.value) return
  try {
    await gateway.request('session.interrupt', { session_id: runId.value }, 15_000)
  } catch (e) {
    pushSystem(`中断失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/**
 * 把内核事件落到当前会话的消息列表。
 * 只认属于本会话的事件(内核有时给空 session_id,那种视为本会话)。
 */
export function noteTranscriptEvent(e: GatewayEvent): void {
  // 没附着会话就没有「这一屏」可写:此时任何事件都不该凭空生出消息行
  if (!runId.value) return
  const sid = e.session_id
  // 内核偶尔给空 session_id,那种归给当前会话
  if (sid && sid !== runId.value && sid !== storedId.value && sid !== sessionKey.value) return

  const p = (e.payload ?? {}) as Record<string, unknown>

  switch (e.type) {
    case 'message.delta': {
      const text = str(p.text)
      if (!text) return
      turnActive.value = true
      appendAssistant(text, 'text')
      return
    }
    case 'reasoning.delta':
    case 'thinking.delta': {
      const text = str(p.text)
      if (!text) return
      appendAssistant(text, 'reasoning')
      return
    }
    case 'reasoning.available': {
      // 非流式提供整块推理:当前行已有推理就跳过,避免重复贴一遍
      const text = str(p.text)
      const row = openAssistant ? rows.value.find((r) => r.key === openAssistant) : undefined
      if (text && !(row && row.reasoning)) appendAssistant(text, 'reasoning')
      return
    }
    case 'message.interim': {
      // 工具调用旁边的解说文本:独立成段,并把上一条封口
      const text = str(p.text)
      sealAssistant()
      if (text) {
        rows.value.push({
          key: liveKey('i'), kind: 'assistant', text, time: hhmm(Date.now() / 1000),
        })
      }
      return
    }
    case 'tool.start': {
      sealAssistant()
      rows.value.push({
        key: liveKey('t'), kind: 'tool', text: '', time: hhmm(Date.now() / 1000),
        name: str(p.name) || '工具',
        context: str(p.context) || str(p.preview),
        args: p.args ? JSON.stringify(p.args, null, 1) : str(p.args_text),
        toolId: str(p.tool_id),
        running: true,
      })
      return
    }
    case 'tool.complete': {
      const tid = str(p.tool_id)
      const row = rows.value.find((r) => r.kind === 'tool' && r.toolId && r.toolId === tid)
      if (row) {
        row.running = false
        row.result = str(p.result_text) || str(p.summary)
        if (typeof p.duration_s === 'number') row.duration = p.duration_s
      }
      return
    }
    case 'message.complete': {
      sealAssistant()
      turnActive.value = false
      running.value = false
      liveStatus.value = 'idle'
      const status = str(p.status)
      if (status === 'error') {
        pushSystem(`本轮出错:  ${str(p.error) || str(p.failure_reason) || '未知原因'}`)
      } else if (status === 'interrupted') {
        pushSystem('本回合已中断')
      }
      return
    }
    case 'error': {
      sealAssistant()
      turnActive.value = false
      pushSystem(`错误：${str(p.message) || JSON.stringify(p)}`)
      return
    }
    default:
      // session.title 之类的由 stores/sessions.ts 负责侧栏,这里不重复处理
      return
  }
}

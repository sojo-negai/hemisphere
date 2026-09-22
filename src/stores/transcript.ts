// 会话历史:把 session.resume 拉回来的 transcript 归一化成界面行。
//
// 实测(session.resume → LiveSessionSnapshot)形状:
//   role 只有 user / assistant / tool
//   user:      { role, text, timestamp, row_id }
//   assistant: { role, text, timestamp, row_id, reasoning?, reasoning_content?, reasoning_details? }
//              text 可能为空(纯思考行),所以 reasoning 要单独渲染,否则那行会变空白
//   tool:      { role, name, context, args }   ← args 是 JSON 字符串,不是对象
// 同一响应还给出 status(idle/working/waiting…)、running、messages_omitted、session_key(存储 id)
// 与一个新的运行 session_id —— 发消息要用运行 id,改标题/归档用存储 id。

import { ref } from 'vue'
import { isPreview } from '../lib/preview'
import { gateway } from './connection'

export type RowKind = 'user' | 'assistant' | 'tool'

export interface TranscriptRow {
  /** 稳定 key:优先用内核的 row_id,没有就按下标合成 */
  key: string
  kind: RowKind
  text: string
  time: string
  /** assistant 行的推理(纯思考行只有它) */
  reasoning?: string
  /** tool 行的工具名 */
  name?: string
  /** tool 行的参数摘要(也可以是人读的 context) */
  context?: string
  /** tool 行的原始参数(JSON 字符串) */
  args?: string
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
/** 会话的实时状态(LiveSessionStatus)与是否正在跑 */
export const liveStatus = ref('')
export const running = ref(false)

/** 当前会话的三个身份:存储 id(界面用)、运行 id(发消息用)、内核 key */
export const storedId = ref('')
export const runId = ref('')
export const sessionKey = ref('')

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
        key,
        kind: 'tool',
        text: '',
        time: '',
        name: m.name || '工具',
        context: m.context || '',
        args,
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
  } catch (e) {
    rows.value = []
    loadError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

/** 清空(切到别的会话前调用) */
export function clearTranscript(): void {
  rows.value = []
  loadError.value = ''
  omitted.value = false
  liveStatus.value = ''
  running.value = false
  runId.value = ''
  sessionKey.value = ''
  storedId.value = ''
}
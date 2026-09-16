// 连接与会话状态:纯 ref/reactive,不引状态库。
// 组合式 API 的响应性本身就是状态方案——把 ref 导出即全局 store;
// 等状态复杂度上来再考虑 Pinia(迁移是机械劳动,不必提前架构)。

import { ref, reactive } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { GatewayClient, type GatewayEvent, type ConnectionState } from '../lib/gateway-client'

export interface BackendInfo {
  port: number
  token: string
  ws_url: string
}

export type Phase = 'idle' | 'starting' | 'connected' | 'error'

// ── 响应式状态(导出即全局共享) ────────────────────────

/** 连接阶段:UI 据此渲染状态栏 */
export const phase = ref<Phase>('idle')
export const errorMessage = ref('')
/** WebSocket 是否处于 open(与 phase 分开:断线时 phase 仍可为 connected) */
export const connected = ref(false)

export interface TranscriptItem {
  kind: 'user' | 'assistant' | 'system'
  text: string
  /** assistant 专属:流式输出中,尾部渲染闪烁光标 */
  streaming?: boolean
}

/** 会话流。reactive 数组可直接 push / 改属性,无需不可变拷贝 */
export const items = reactive<TranscriptItem[]>([])
export const draft = ref('')
export const streaming = ref(false)

/** 当前活动会话 id(session.create 之后回填) */
export const sessionId = ref('')

export const gateway = new GatewayClient()

/** 清空会话流(新对话时用) */
export function resetTranscript() {
  items.splice(0, items.length)
  streaming.value = false
}

// ── 动作 ──────────────────────────────────────────────

/**
 * 拉起后端并建立 WebSocket 连接。
 * 步骤:Rust start_backend(spawn + 等就绪文件)→ connect(ws_url) → session.list 验活。
 * 方法名已对照 tui_gateway/methods_*.py 核实;后端无 system.ping 之类探活方法,
 * 故用最便宜的只读 RPC session.list 验证链路真的通。
 */
export async function startAndConnect(): Promise<void> {
  phase.value = 'starting'
  errorMessage.value = ''
  try {
    const info = await invoke<BackendInfo>('start_backend')

    gateway.onState((s: ConnectionState) => {
      connected.value = s === 'open'
      if (s === 'closed' || s === 'error') {
        phase.value = 'error'
        errorMessage.value = s === 'error' ? '连接失败' : '连接已断开'
      }
    })

    await gateway.connect(info.ws_url)
    // 只读 RPC 验活:WS open ≠ 后端可用,再打一发确认方法面可达
    await gateway.request('session.list', {}, 15_000)
    phase.value = 'connected'
  } catch (e) {
    phase.value = 'error'
    errorMessage.value = String(e)
    throw e
  }
}

/** 订阅全部网关事件(组件 onMounted 时挂上) */
export function subscribeEvents(h: (e: GatewayEvent) => void): () => void {
  return gateway.on('*', h)
}

/**
 * 发送一条用户消息。
 * 流程:session.create(若尚无会话)→ prompt.submit;
 * 助手回复以 message.delta / message.complete 事件异步推送,由 handleEvent 归并。
 */
export async function send(text: string): Promise<void> {
  if (!text.trim() || streaming.value) return
  items.push({ kind: 'user', text })
  try {
    if (!sessionId.value) {
      // 已实测:session.create 返回 { session_id, stored_session_id, message_count, messages, info }
      const created = await gateway.request<{ session_id?: string }>('session.create', {}, 30_000)
      sessionId.value = created.session_id ?? ''
    }
    // 已实测:prompt.submit 接受 params.session_id + params.text
    await gateway.request('prompt.submit', { session_id: sessionId.value, text }, 30_000)
  } catch (e) {
    items.push({ kind: 'system', text: `提交失败：${String(e)}` })
  }
}

/**
 * 事件 → 会话流的归并规则:
 * - message.delta:追加文本;若最后一条还是同一条流式 assistant 消息则原地续写
 * - message.complete:该条流式消息收尾(光标消失)
 * - error:以系统条目呈现,不打断已有内容
 */
export function handleEvent(e: GatewayEvent) {
  const p = (e.payload ?? {}) as Record<string, unknown>
  if (e.type === 'message.delta') {
    const text = typeof p.text === 'string' ? p.text : ''
    if (!text) return
    streaming.value = true
    const last = items[items.length - 1]
    if (last && last.kind === 'assistant' && last.streaming) {
      last.text += text
    } else {
      items.push({ kind: 'assistant', text, streaming: true })
    }
  } else if (e.type === 'message.complete') {
    const last = items[items.length - 1]
    if (last && last.kind === 'assistant') last.streaming = false
    streaming.value = false
  } else if (e.type === 'error') {
    const msg = typeof p.message === 'string' ? p.message : JSON.stringify(p)
    items.push({ kind: 'system', text: `错误：${msg}` })
  }
}

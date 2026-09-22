// 连接与会话状态:纯 ref/reactive,不引状态库。

import { ref, reactive } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { GatewayClient, type GatewayEvent, type ConnectionState } from '../lib/gateway-client'

export interface BackendInfo {
  port: number
  token: string
  ws_url: string
}

export type Phase = 'idle' | 'starting' | 'connected' | 'disconnected' | 'error'

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

/** 后端连接信息(端口/令牌/WS 地址),连接成功后回填,供状态栏与会话详情展示 */
export const backendInfo = ref<BackendInfo | null>(null)

export const gateway = new GatewayClient()

/** 清空会话流(新对话时用) */
export function resetTranscript() {
  items.splice(0, items.length)
  streaming.value = false
}

// ── 断线重连 ──────────────────────────────────────────

/** 退避序列(ms):1s → 2s → 4s → 8s → 15s → 30s 封顶 */
const RECONNECT_BACKOFF = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000]
/** 重试到第几次开始怀疑内核进程已死,重新 spawn */
const RESPAWN_AFTER = 3

/** 已重试次数(UI 可据此显示“重连中(3)”)*/
export const reconnectAttempt = ref(0)
let reconnectTimer: number | null = null
/** 是否曾经连上过:决定断线时进 disconnected(自动重连)还是 error(交给门禁页)*/
let hadConnection = false

function clearReconnectTimer() {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

/** 连上并验活(不含 spawn)。ping 是协议内方法,实测返回 {"pong":true} */
async function attach(wsUrl: string): Promise<void> {
  await gateway.connect(wsUrl)
  await gateway.request('ping', {}, 10_000)
}

/** 退避重连;多次失败后重新拉起后端进程(旧端口已作废)*/
function scheduleReconnect() {
  if (reconnectTimer !== null) return
  const delay = RECONNECT_BACKOFF[Math.min(reconnectAttempt.value, RECONNECT_BACKOFF.length - 1)]
  reconnectTimer = window.setTimeout(async () => {
    reconnectTimer = null
    reconnectAttempt.value += 1
    try {
      if (reconnectAttempt.value >= RESPAWN_AFTER) {
        backendInfo.value = await invoke<BackendInfo>('start_backend')
      }
      const url = backendInfo.value?.ws_url
      if (!url) throw new Error('缺少后端连接信息')
      await attach(url)
      phase.value = 'connected'
      errorMessage.value = ''
      reconnectAttempt.value = 0
    } catch {
      if (hadConnection) phase.value = 'disconnected'
      scheduleReconnect()
    }
  }, delay)
}

/** 网关状态 → 阶段。断线后自动进入退避重连,不用用户点。 */
gateway.onState((s: ConnectionState) => {
  connected.value = s === 'open'
  if (s === 'open') {
    if (hadConnection) { phase.value = 'connected'; clearReconnectTimer() }
    return
  }
  if (s === 'closed' || s === 'error') {
    if (hadConnection) {
      phase.value = 'disconnected'
      scheduleReconnect()
    }
  }
})

// ── 动作 ──────────────────────────────────────────────

/**
 * 拉起后端并建立 WebSocket 连接。
 * 步骤:Rust start_backend(spawn + 等就绪文件)→ connect(ws_url) → ping 验活。
 * 方法名已对照 tui_gateway/contracts/*.py 核实(共 102 个方法)。
 */
export async function startAndConnect(): Promise<void> {
  phase.value = 'starting'
  errorMessage.value = ''
  try {
    const info = await invoke<BackendInfo>('start_backend')
    backendInfo.value = info
    await attach(info.ws_url)
    hadConnection = true
    reconnectAttempt.value = 0
    phase.value = 'connected'
  } catch (e) {
    phase.value = 'error'
    errorMessage.value = String(e)
    // 门禁页会给出重试入口,同时在后台按退避自动重试
    scheduleReconnect()
    throw e
  }
}

/** 订阅全部网关事件(组件 onMounted 时挂上) */
/**
 * 浏览器内预览开关(?preview=1)。
 * Tauri 之外无法调用 Rust 的 start_backend,做界面时用假连接状态渲染主界面;
 * 仅在开发构建生效(import.meta.env.DEV),生产包中该分支会被摇树移除。
 */
if (import.meta.env.DEV && new URLSearchParams(location.search).has('preview')) {
  const port = 51234
  backendInfo.value = {
    port,
    token: 'preview-token',
    ws_url: `ws://127.0.0.1:${port}/api/ws?token=preview-token`,
  }
  sessionId.value = 'preview_session_0001'
  connected.value = true
  phase.value = 'connected'
  // 示例消息:让消息流样式可在浏览器里审阅
  items.push(
    { kind: 'user', text: '帮我梳理一下新客户端的信息架构。' },
    {
      kind: 'assistant',
      text: '按「外壳常驻、视图切换」来分层：标题栏与侧栏属于外壳，对话 / 能力 / 设置三个视图在主区切换。会话列表按项目或平台分组，方便你在多个工作区之间跳转。',
    },
    { kind: 'user', text: '对话列宽能调吗？' },
    { kind: 'assistant', text: '可以，两侧手柄拖拽即可，范围 480–1400px，宽度会记在本地。', streaming: true },
  )
}

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

// 连接与会话状态:纯 ref/reactive,不引状态库。

import { ref } from 'vue'
import { isPreview } from '../lib/preview'
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

/** 输入框草稿(消息流在 stores/transcript.ts) */
export const draft = ref('')

/** 后端连接信息(端口/令牌/WS 地址),连接成功后回填,供状态栏与会话详情展示 */
export const backendInfo = ref<BackendInfo | null>(null)

export const gateway = new GatewayClient()

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

// 浏览器内预览(?preview=1):Tauri 之外调不到 Rust 的 start_backend,
// 用假连接状态把主界面撑起来;仅开发构建生效,生产包里该分支被摇树移除。
// 这里只造假「连接」,不造会话数据 —— 界面示例由各自的视图提供。
if (isPreview) {
  const port = 51234
  backendInfo.value = {
    port,
    token: 'preview-token',
    ws_url: `ws://127.0.0.1:${port}/api/ws?token=preview-token`,
  }
  connected.value = true
  phase.value = 'connected'
}

/** 订阅全部网关事件(组件 onMounted 时挂上) */

export function subscribeEvents(h: (e: GatewayEvent) => void): () => void {
  return gateway.on('*', h)
}

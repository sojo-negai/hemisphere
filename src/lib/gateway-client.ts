// JSON-RPC 网关客户端(WebSocket 传输)。
// 与 @hermes/shared 的 JsonRpcGatewayClient 协议兼容:同一帧格式、同一事件模型,
// 因此对端既可以是本机 hermes serve,也可以是远程网关。

// ── 类型 ──────────────────────────────────────────────

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

/** 后端主动推送的事件帧;type 取值清单见官方 apps/shared/src/json-rpc-gateway.ts */
export interface GatewayEvent {
  type: string
  payload?: unknown
  session_id?: string
}

/** 挂起中的请求:resolve/reject 句柄 + 超时计时器 */
type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number }

/** 网关返回的错误负载(JSON-RPC error 对象) */
export class JsonRpcGatewayError extends Error {
  code?: number
  data?: unknown
  constructor(message: string, code?: number, data?: unknown) {
    super(message)
    this.name = 'JsonRpcGatewayError'
    this.code = code
    this.data = data
  }
}

// ── 客户端 ────────────────────────────────────────────

export class GatewayClient {
  private socket: WebSocket | null = null
  private nextId = 0
  /** 请求 id → 挂起调用;响应帧按 id 配对后即删 */
  private pending = new Map<number, Pending>()
  /** 事件订阅表:具体事件名 + '*' 通配 */
  private eventHandlers = new Map<string, Set<(e: GatewayEvent) => void>>()
  private stateHandlers = new Set<(s: ConnectionState) => void>()
  private state: ConnectionState = 'idle'
  private heartbeat: number | null = null
  private lastInbound = 0

  /** 连接状态订阅:注册时立即回调一次当前状态,便于 UI 初始化 */
  onState(h: (s: ConnectionState) => void): () => void {
    this.stateHandlers.add(h)
    h(this.state)
    return () => this.stateHandlers.delete(h)
  }

  /** 订阅某类事件;type 传 '*' 接收全部。返回退订函数。 */
  on(type: string, h: (e: GatewayEvent) => void): () => void {
    let set = this.eventHandlers.get(type)
    if (!set) {
      set = new Set()
      this.eventHandlers.set(type, set)
    }
    set.add(h)
    return () => set!.delete(h)
  }

  get connectionState(): ConnectionState {
    return this.state
  }

  private setState(s: ConnectionState) {
    this.state = s
    this.stateHandlers.forEach((h) => h(s))
  }

  /** 建立 WebSocket 连接;连接超时默认 15s,防止永远卡在 connecting */
  connect(wsUrl: string, connectTimeoutMs = 15000): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve()
    this.setState('connecting')

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl)
      this.socket = ws

      const timer = window.setTimeout(() => {
        if (this.socket === ws && this.state === 'connecting') {
          try { ws.close() } catch { /* ignore */ }
          this.socket = null
          this.setState('error')
          reject(new Error('connection timed out'))
        }
      }, connectTimeoutMs)

      ws.addEventListener('open', () => {
        window.clearTimeout(timer)
        this.setState('open')
        this.lastInbound = Date.now()
        this.startHeartbeat()
        resolve()
      })

      ws.addEventListener('message', (ev) => {
        this.lastInbound = Date.now()
        this.handleMessage(ev.data)
      })

      ws.addEventListener('close', () => {
        window.clearTimeout(timer)
        // 仅处理「当前这代」socket 的关闭;旧连接的迟到事件直接忽略
        if (this.socket !== ws) return
        this.socket = null
        this.stopHeartbeat()
        this.setState('closed')
        this.rejectAll(new Error('WebSocket closed'))
      })

      ws.addEventListener('error', () => {
        window.clearTimeout(timer)
        if (this.socket === ws && this.state === 'connecting') {
          this.socket = null
          this.setState('error')
          reject(new Error('connection failed'))
        }
      })
    })
  }

  /** 主动关闭并清理所有挂起请求 */
  close() {
    this.stopHeartbeat()
    const ws = this.socket
    this.socket = null
    if (ws) {
      try { ws.close() } catch { /* ignore */ }
    }
    this.setState('closed')
    this.rejectAll(new Error('client closed'))
  }

  /** 发起一次 JSON-RPC 请求;timeoutMs 默认 120s(流式长回答场景) */
  request<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 120_000): Promise<T> {
    const ws = this.socket
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('gateway not connected'))
    }
    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`request timed out after ${Math.round(timeoutMs / 1000)}s: ${method}`))
        }
      }, timeoutMs)

      this.pending.set(id, {
        resolve: (v) => { window.clearTimeout(timer); resolve(v as T) },
        reject: (e) => { window.clearTimeout(timer); reject(e) },
        timer,
      })

      // 请求帧格式:{ jsonrpc, id, method, params } —— 与官方网关一致
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  /**
   * 入站帧分发。两种帧形状(已对真实后端实测确认):
   *   响应: { jsonrpc, id, result } 或 { jsonrpc, id, error }
   *   事件: { jsonrpc, method: 'event', params: { type, session_id, payload } }
   * ⚠ 事件的 type 藏在 params 里,不在顶层——按顶层 type 判断会漏掉全部事件。
   */
  private handleMessage(raw: unknown) {
    let frame: Record<string, unknown>
    try {
      frame = JSON.parse(String(raw))
    } catch {
      return
    }

    // 事件推送(method === 'event')
    if (frame.method === 'event') {
      const p = (frame.params ?? {}) as Record<string, unknown>
      if (typeof p.type === 'string') {
        this.dispatch({
          type: p.type,
          payload: p.payload,
          session_id: typeof p.session_id === 'string' ? p.session_id : undefined,
        })
      }
      return
    }

    // 响应帧:按 id 配对挂起请求
    if (frame.id !== undefined && frame.id !== null && (frame.result !== undefined || frame.error !== undefined)) {
      const numeric = typeof frame.id === 'number' ? frame.id : Number(frame.id)
      const entry = this.pending.get(numeric)
      if (entry) {
        this.pending.delete(numeric)
        if (frame.error) {
          const err = frame.error as { message?: string; code?: number; data?: unknown }
          entry.reject(new JsonRpcGatewayError(err.message ?? 'gateway error', err.code, err.data))
        } else {
          entry.resolve(frame.result)
        }
      }
      return
    }

    // 兜底:顶层直接带 type 的旧式帧(兼容保留)
    if (typeof frame.type === 'string') {
      this.dispatch(frame as unknown as GatewayEvent)
    }
  }

  /** 把事件分发给具体订阅者与 '*' 通配订阅者 */
  private dispatch(event: GatewayEvent) {
    this.eventHandlers.get(event.type)?.forEach((h) => h(event))
    this.eventHandlers.get('*')?.forEach((h) => h(event))
  }

  private rejectAll(err: Error) {
    this.pending.forEach((p) => p.reject(err))
    this.pending.clear()
  }

  /**
   * 心跳:15s 打一发协议内的 ping 方法(实测返回 {"pong":true},pong 会刷新 lastInbound);
   * 超过 45s 没有任何入站流量则判定死链,主动断开交由上层重连。
   */
  private startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeat = window.setInterval(() => {
      if (Date.now() - this.lastInbound > 45_000) {
        this.close()
        return
      }
      this.request('ping', {}, 8000).catch(() => this.close())
    }, 15_000)
  }

  private stopHeartbeat() {
    if (this.heartbeat !== null) {
      window.clearInterval(this.heartbeat)
      this.heartbeat = null
    }
  }
}

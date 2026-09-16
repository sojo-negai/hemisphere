<script setup lang="ts">
// 对话视图:会话头 + 可拖拽调宽的消息流 + 输入区 + 消息导航。
// 目前消息来自 stores/connection 的真实状态;未连接时用示例数据撑起布局,
// 待接入后端后删掉 demo 分支即可(见 isDemo)。
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { NDropdown, NPopover, NTooltip } from 'naive-ui'
import {
  ArrowDownToLine, ArrowUpToLine, ChevronDown, ChevronUp, GitBranch, LayoutGrid,
  MoreHorizontal, Send,
} from 'lucide-vue-next'
import {
  connected, draft, handleEvent, items, phase, send, streaming, subscribeEvents,
} from '../stores/connection'

const transcriptEl = ref<HTMLElement | null>(null)
const stageEl = ref<HTMLElement | null>(null)

/* ── 会话级操作 ───────────────────────────────── */
const DANGER_STYLE = { color: 'var(--danger)' }

const moreOptions = [
  { label: '重命名会话', key: 'rename' },
  { label: '导出记录', key: 'export' },
  { label: '会话设置', key: 'settings' },
  { type: 'divider', key: 'd1' },
  { label: '归档', key: 'archive' },
  { type: 'divider', key: 'd2' },
  { label: '删除会话', key: 'delete', props: { style: DANGER_STYLE, class: 'danger-option' } },
]
/* ── 拖拽调宽(480–1400,记忆到 localStorage) ──── */
const CHAT_W_KEY = 'hemisphere-chat-w'
const CHAT_W_MIN = 480
const CHAT_W_MAX = 1400
const CHAT_W_DEFAULT = 880
const chatW = ref(Number(localStorage.getItem(CHAT_W_KEY)) || CHAT_W_DEFAULT)

watch(chatW, (w) => {
  localStorage.setItem(CHAT_W_KEY, String(w))
  stageEl.value?.style.setProperty('--chat-w', `${w}px`)
})

function startResize(e: PointerEvent, dir: number) {
  e.preventDefault()
  const startX = e.clientX
  const startW = chatW.value
  const move = (ev: PointerEvent) => {
    const next = startW + dir * (ev.clientX - startX)
    chatW.value = Math.max(CHAT_W_MIN, Math.min(CHAT_W_MAX, next))
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

/* ── 事件订阅与滚动 ───────────────────────────── */
let unsubscribe: (() => void) | null = null
onMounted(() => {
  stageEl.value?.style.setProperty('--chat-w', `${chatW.value}px`)
  unsubscribe = subscribeEvents((e) => {
    handleEvent(e)
    void nextTick(scrollToBottom)
  })
})
onUnmounted(() => unsubscribe?.())

function scrollToBottom() {
  const el = transcriptEl.value
  if (el) el.scrollTop = el.scrollHeight
}

function scrollToTop() {
  const el = transcriptEl.value
  if (el) el.scrollTop = 0
}

/** 用户消息索引:用于右侧导航快速定位(与渲染顺序一一对应) */
interface UserMessage {
  index: number
  text: string
  time: string
}
const userMessages = computed<UserMessage[]>(() => {
  const out: UserMessage[] = []
  if (isDemo.value) {
    demoRows.forEach((r, i) => {
      if (r.role === 'user') out.push({ index: i, text: r.text, time: r.time })
    })
  } else {
    items.forEach((it, i) => {
      if (it.kind === 'user') out.push({ index: i, text: it.text, time: '' })
    })
  }
  return out
})

function jumpToMessage(index: number) {
  jumpTo(index)
}

/* ── 示例数据(仅为验证布局,接入后端后删除)──────── */
const isDemo = computed(() => items.length === 0 && !connected.value)
const demoRows = [
  { role: 'user', name: '你', time: '10:24', text: '帮我梳理一下新客户端的信息架构。' },
  {
    role: 'assistant',
    name: 'Hermes',
    time: '10:24',
    text: '按「外壳常驻、视图切换」来分层：标题栏与侧栏属于外壳，对话/设置/任务三个视图在主区切换。会话列表按项目或平台分组，便于你在多个工作区之间跳转。',
  },
  { role: 'user', name: '你', time: '10:26', text: '对话列宽能调吗？' },
  {
    role: 'assistant',
    name: 'Hermes',
    time: '10:26',
    text: '可以，两侧手柄拖拽即可，范围 380–1240px，宽度会记在本地。',
  },
]

/* ── 发送 ─────────────────────────────────────── */
async function onSend() {
  const text = draft.value.trim()
  if (!text) return
  if (!connected.value) {
    // 未连接时把内容留在输入框,并提示需要先连后端
    return
  }
  draft.value = ''
  await send(text)
  void nextTick(scrollToBottom)
}

/** 空会话:用于把空态在消息区里垂直居中 */
const isBlank = computed(() => !isDemo.value && items.length === 0)

/* ── 消息导航 ─────────────────────────────────── */
const cursor = ref(-1)
const msgPickerOpen = ref(false)
function jumpTo(index: number) {
  const nodes = transcriptEl.value?.querySelectorAll<HTMLElement>('.message')
  if (!nodes?.length) return
  cursor.value = Math.max(0, Math.min(nodes.length - 1, index))
  const el = nodes[cursor.value]
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  el.classList.add('jump-flash')
  window.setTimeout(() => el.classList.remove('jump-flash'), 900)
}

</script>

<template>
  <div class="conversation">
    <!-- 会话头 -->
    <header class="conversation-head">
      <div class="conversation-title">
        <h1>梳理新客户端的信息架构</h1>
      </div>
      <div class="head-actions">
        <n-tooltip trigger="hover">
          <template #trigger>
            <button class="icon-btn" aria-label="分支对话">
              <GitBranch :size="15" />
            </button>
          </template>
          分支
        </n-tooltip>

        <n-dropdown trigger="click" placement="bottom-end" :options="moreOptions">
          <button class="icon-btn" aria-label="更多操作">
            <MoreHorizontal :size="15" />
          </button>
        </n-dropdown>
      </div>
    </header>

    <!-- 消息流(两侧手柄可拖拽调宽) -->
    <div ref="stageEl" class="chat-stage">
      <section ref="transcriptEl" class="transcript" :class="{ blank: isBlank }">
        <!-- 手柄贴在聊天列两侧;高度跟随消息区,不随滚动位移 -->
        <div class="chat-frame" aria-hidden="true">
          <div class="chat-handle left" role="separator" aria-label="调整对话宽度" @pointerdown="startResize($event, -1)" />
          <div class="chat-handle right" role="separator" aria-label="调整对话宽度" @pointerdown="startResize($event, 1)" />
        </div>
        <div class="chat-col">
          <!-- 空状态:已连接但尚未产生消息 -->
          <div v-if="!isDemo && items.length === 0" class="blank-state">
            <div class="blank-mark">H</div>
            <strong>还没有消息</strong>
            <span>在下面描述你的任务，Hermes 会边执行边把过程写在这里。</span>
          </div>

          <div v-else class="date-divider">今天</div>

          <!-- 示例数据分支 -->
          <template v-if="isDemo">
            <article v-for="(row, i) in demoRows" :key="i" class="message" :class="row.role">
              <div class="message-avatar">{{ row.role === 'user' ? '你' : 'H' }}</div>
              <div class="message-body">
                <div class="message-meta">
                  <span class="message-name">{{ row.name }}</span>
                  <span>{{ row.time }}</span>
                  <span class="demo-tag">示例</span>
                </div>
                <div class="message-text">{{ row.text }}</div>
              </div>
            </article>
          </template>

          <!-- 真实数据分支 -->
          <template v-else>
            <article
              v-for="(row, i) in items"
              :key="i"
              class="message"
              :class="row.kind === 'user' ? 'user' : row.kind === 'assistant' ? 'assistant' : 'system'"
            >
              <div class="message-avatar">{{ row.kind === 'user' ? '你' : row.kind === 'assistant' ? 'H' : '!' }}</div>
              <div class="message-body">
                <div class="message-meta">
                  <span class="message-name">
                    {{ row.kind === 'user' ? '你' : row.kind === 'assistant' ? 'Hermes' : '系统' }}
                  </span>
                </div>
                <div class="message-text">
                  {{ row.text }}<span v-if="row.streaming" class="caret">▍</span>
                </div>
              </div>
            </article>
          </template>
        </div>
      </section>

      <!-- 输入区 + 消息导航 -->
      <div class="composer-wrap">
        <form class="composer" @submit.prevent="onSend">
          <textarea
            v-model="draft"
            rows="2"
            :placeholder="connected ? '继续描述你的任务…' : '未连接后端：先点顶部「连接」'"
            @keydown.enter.exact.prevent="onSend"
          />
          <div class="composer-foot">
            <span class="hint">
              <template v-if="streaming">正在生成…</template>
              <template v-else-if="phase === 'starting'">正在启动 hermes serve…</template>
              <template v-else-if="!connected">Enter 发送 · 先连接后端</template>
              <template v-else>Enter 发送 · Shift+Enter 换行</template>
            </span>
            <button class="send" type="submit" :disabled="!connected || streaming || !draft.trim()">
              <Send :size="15" />
            </button>
          </div>
        </form>

      </div>

      <!-- 消息导航:回到顶部 / 上一条 / 我的消息 / 下一条 / 回到底部 -->
      <nav class="msg-nav" aria-label="消息导航">
        <n-tooltip trigger="hover" placement="left">
          <template #trigger>
            <button class="nav-btn" aria-label="回到顶部" @click="scrollToTop">
              <ArrowUpToLine :size="15" />
            </button>
          </template>
          回到顶部
        </n-tooltip>

        <n-tooltip trigger="hover" placement="left">
          <template #trigger>
            <button class="nav-btn" aria-label="上一条" @click="jumpTo(cursor - 1)">
              <ChevronUp :size="15" />
            </button>
          </template>
          上一条
        </n-tooltip>

        <span class="nav-sep" />

        <n-popover v-model:show="msgPickerOpen" trigger="click" placement="left" :style="{ padding: 0 }">
          <template #trigger>
            <button class="nav-btn" :class="{ on: msgPickerOpen }" aria-label="我的消息">
              <LayoutGrid :size="15" />
              <span class="nav-count">{{ userMessages.length }}</span>
            </button>
          </template>
          <div class="mine-panel">
            <div class="mine-head">
              <strong>我发送的消息</strong>
              <span>{{ userMessages.length }} 条 · 点击定位</span>
            </div>
            <button
              v-for="(m, i) in userMessages"
              :key="m.index"
              class="mine-row"
              @click="jumpToMessage(m.index)"
            >
              <span class="mine-index">{{ i + 1 }}</span>
              <span class="mine-text">{{ m.text }}</span>
              <span v-if="m.time" class="mine-time">{{ m.time }}</span>
            </button>
            <p v-if="!userMessages.length" class="mine-empty">这个会话里还没有你的消息</p>
          </div>
        </n-popover>

        <span class="nav-sep" />

        <n-tooltip trigger="hover" placement="left">
          <template #trigger>
            <button class="nav-btn" aria-label="下一条" @click="jumpTo(cursor + 1)">
              <ChevronDown :size="15" />
            </button>
          </template>
          下一条
        </n-tooltip>

        <n-tooltip trigger="hover" placement="left">
          <template #trigger>
            <button class="nav-btn" aria-label="回到底部" @click="scrollToBottom">
              <ArrowDownToLine :size="15" />
            </button>
          </template>
          回到底部
        </n-tooltip>
      </nav>
    </div>
  </div>
</template>

<style scoped>
.conversation {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

/* 会话头 */
.conversation-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 22px;
  border-bottom: 1px solid var(--border);
}

.conversation-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.conversation-title h1 {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.head-actions {
  margin-left: auto;
  display: flex;
  gap: 2px;
}

.icon-btn {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
}
.icon-btn:hover { background: var(--fg-soft); color: var(--fg); }

/* 消息流舞台 */
.chat-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.transcript {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 0 8px;
}

.chat-col {
  width: var(--chat-w, 720px);
  max-width: calc(100% - 32px);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.chat-frame {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: var(--chat-w, 720px);
  max-width: calc(100% - 32px);
  transform: translateX(-50%);
  pointer-events: none; /* 只让手柄接收事件,不遮挡正文 */
  z-index: 2;
}

.chat-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: col-resize;
  pointer-events: auto;
}
/* 往外让开一点,不贴着正文 */
.chat-handle.left { left: -18px; }
.chat-handle.right { right: -18px; }

/* 手柄默认隐藏,鼠标进入消息区才出现 */
.chat-handle::after {
  content: "";
  width: 3px;
  height: 46px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--muted) 45%, transparent);
  opacity: 0;
  transition: opacity 0.16s, background 0.15s, height 0.15s;
}
.chat-stage:hover .chat-handle::after { opacity: 0.55; }
.chat-handle:hover::after {
  opacity: 1;
  height: 72px;
  background: var(--accent);
}

.date-divider {
  align-self: center;
  color: var(--muted);
  font: 10px var(--font-mono);
  letter-spacing: 0.06em;
}

/* 空会话:消息区整块垂直居中,不再用固定 12vh 顶下去。
   这里要顺带清掉上下不对称的内边距(20px/8px),否则居中会整体偏 6px。 */
.transcript.blank {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0;
}

.blank-state {
  margin: 0 auto;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  text-align: center;
}
.blank-mark {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  margin-bottom: 4px;
  border: 1px solid var(--border);
  border-radius: 11px;
  color: var(--muted);
  font: 13px var(--font-mono);
}
.blank-state strong { font-size: 13px; font-weight: 600; }
.blank-state span { color: var(--muted); font-size: 12px; line-height: 1.6; }

/* 消息 */
.message {
  display: flex;
  gap: 12px;
}

.message-avatar {
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 600;
  background: var(--fg-soft);
  color: var(--muted);
}
.message.user .message-avatar {
  background: var(--accent-soft);
  color: var(--accent);
}

.message-body { min-width: 0; flex: 1; }

.message-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
  color: var(--muted);
  font-size: 11px;
}
.message-name { color: var(--fg); font-weight: 600; font-size: 12px; }

.demo-tag {
  padding: 0 5px;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 9px;
}

.message-text {
  font-size: 14px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}
.message.system .message-text { color: var(--danger); font-size: 12px; }

.caret {
  color: var(--accent);
  animation: blink 1s steps(2) infinite;
}
@keyframes blink { 50% { opacity: 0; } }

/* 输入区 */
.composer-wrap {
  flex: 0 0 auto;
  position: relative;
  padding: 0 0 14px;
}

.composer {
  width: var(--chat-w, 720px);
  max-width: calc(100% - 32px);
  margin: 0 auto;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
  box-shadow: 0 6px 20px color-mix(in oklch, var(--fg) 6%, transparent);
}

.composer textarea {
  width: 100%;
  border: 0;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--fg);
  font-size: 14px;
  line-height: 1.6;
}
.composer textarea::placeholder { color: var(--muted); }

.composer-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
}

.hint {
  color: var(--muted);
  font-size: 11px;
  flex: 1;
}

.send {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: var(--accent);
  color: #fff;
}
.send:disabled { opacity: 0.35; }

/* 消息导航 */
.msg-nav {
  position: absolute;
  right: 18px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  box-shadow: 0 6px 18px color-mix(in oklch, var(--fg) 8%, transparent);
}

.nav-btn {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
}
.nav-btn:hover { background: var(--fg-soft); color: var(--fg); }

.nav-btn.on { background: var(--accent-soft); color: var(--accent); }

/* 用细线把「滚动」与「逐条浏览」两组操作分开 */
.nav-sep {
  height: 1px;
  margin: 2px 5px;
  background: var(--border);
}

.nav-count {
  position: absolute;
  transform: translate(11px, -11px);
  min-width: 13px;
  height: 13px;
  padding: 0 3px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font-size: 9px;
  line-height: 13px;
  text-align: center;
}

/* 我的消息面板(快速定位) */
.mine-panel {
  width: 320px;
  max-height: 320px;
  overflow-y: auto;
}

.mine-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 11px 13px;
  border-bottom: 1px solid var(--border);
}
.mine-head strong { font-size: 12.5px; }
.mine-head span { color: var(--muted); font-size: 10.5px; }

.mine-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 13px;
  border: 0;
  background: transparent;
  color: var(--fg);
  text-align: left;
}
.mine-row:hover { background: var(--fg-soft); }

.mine-index {
  width: 18px;
  flex: 0 0 auto;
  color: var(--muted);
  font: 10px var(--font-mono);
}

.mine-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
}

.mine-time { flex: 0 0 auto; color: var(--muted); font-size: 10.5px; }

.mine-empty { margin: 0; padding: 18px 13px; color: var(--muted); font-size: 11.5px; text-align: center; }

.jump-flash :deep(.message-text) { background: var(--accent-soft); }
</style>

<script setup lang="ts">
// 对话视图:会话头 + 可拖拽调宽的消息流 + 输入区 + 消息导航。
// 消息一律来自 stores/transcript(历史 + 实时流同一来源);
// demoRows 只在浏览器预览(?preview=1,即 isPreview)时出现,走同一套渲染,
// 用于在没有内核时审阅排版(含 markdown / 折叠块)。
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { NDropdown, NPopover, NTooltip } from 'naive-ui'
import {
  ArrowDownToLine, ArrowUpToLine, ChevronDown, ChevronRight, ChevronUp, GitBranch,
  LayoutGrid, MoreHorizontal, Send, Square,
} from 'lucide-vue-next'
import { connected, draft, phase } from '../stores/connection'
import { isPreview } from '../lib/preview'
import { renderMarkdown } from '../lib/markdown'
import { selectedId, sessions } from '../stores/sessions'
import {
  clearTranscript, interruptTurn, loadError, loading as transcriptLoading, omitted, openSession,
  rows as transcriptRows, sendPrompt, submitStatus, turnActive, type TranscriptRow,
} from '../stores/transcript'

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

/* ── 宽度记忆(事件在 AppShell 里统一分发)─────── */
onMounted(() => {
  stageEl.value?.style.setProperty('--chat-w', `${chatW.value}px`)
})

/* ── 折叠块(reasoning / 工具调用):默认收起,不属于「对话正文」 ── */
const expanded = ref<Set<string>>(new Set())
function toggleBlock(key: string) {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}
const isOpen = (key: string) => expanded.value.has(key)

/** 当前视口顶部所在的消息下标(右侧导航的锚点) */
const cursor = ref(-1)

// 侧栏换会话 → 清掉上一份历史再拉新的;拉完回到最新一条
// (expanded/cursor 必须先于本 watch 声明:immediate 回调在 setup 期就会执行)
watch(selectedId, (id) => {
  clearTranscript()
  void openSession(id)
  expanded.value = new Set()
  cursor.value = -1
}, { immediate: true })

/** 用户是否停在底部附近:只有在这儿才自动跟随流式输出 */
const stickToBottom = ref(true)

function onTranscriptScroll() {
  const el = transcriptEl.value
  if (!el) return
  stickToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  // 导航锚点:最后一条「顶部已越过视口上沿」的消息
  const nodes = el.querySelectorAll<HTMLElement>('.message')
  let idx = 0
  nodes.forEach((n, i) => {
    if (n.offsetTop <= el.scrollTop + 8) idx = i
  })
  cursor.value = nodes.length ? idx : -1
}

function scrollToBottom(smooth = false) {
  const el = transcriptEl.value
  if (!el) return
  if (smooth) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  else el.scrollTop = el.scrollHeight
}

// 行数变化或最后一行变长都算「有新内容」;自动跟随要瞬时(平滑动画追不上流式)。
// 只盯 transcriptRows:示例数据是静态的,且此处引用后置声明的 renderRows 会踩 TDZ。
watch(
  () => {
    const list = transcriptRows.value
    const last = list[list.length - 1]
    return `${list.length}:${last ? last.text.length + (last.reasoning?.length ?? 0) : 0}`
  },
  () => {
    if (stickToBottom.value) void nextTick(() => scrollToBottom())
  },
)

function scrollToTop() {
  transcriptEl.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

/** 用户消息索引:用于右侧导航快速定位(与渲染顺序一一对应) */
interface UserMessage {
  index: number
  text: string
  time: string
}

/* ── 示例数据(仅浏览器预览;与真实数据走同一渲染路径)── */
const isDemo = computed(() => isPreview)
const demoRows: TranscriptRow[] = [
  { key: 'd1', kind: 'user', text: '帮我梳理一下新客户端的信息架构。', time: '10:24' },
  {
    key: 'd2', kind: 'assistant', time: '10:24',
    reasoning: '先明确分层:外壳常驻、视图切换;再谈数据流与状态归属。',
    text:
      '按「外壳常驻、视图切换」来分层:\n\n' +
      '- **外壳**:标题栏与侧栏,常驻不动\n' +
      '- **视图**:对话 / 能力 / 设置三个视图在主区切换\n' +
      '- **内核**:`hermes serve`,会话与工具都归它\n\n' +
      '> 会话列表按项目或平台分组,方便你在多个工作区之间跳转。\n\n' +
      '```ts\nconst layers = ["shell", "view", "kernel"] as const\n```',
  },
  { key: 'd3', kind: 'user', text: '对话列宽能调吗?', time: '10:26' },
  {
    key: 'd4', kind: 'tool', time: '10:26', text: '',
    name: 'terminal', context: 'npm run build',
    args: '{"command": "npm run build"}',
    result: 'dist/ 构建完成,1.2s', duration: 1.2,
  },
  {
    key: 'd5', kind: 'assistant', time: '10:26',
    text: '可以,两侧手柄拖拽即可,范围 480–1400px,宽度会记在本地。',
  },
]

/** 渲染列表:预览用示例,真实数据同源 transcript;导航下标才与渲染顺序一致 */
const renderRows = computed<TranscriptRow[]>(() =>
  isDemo.value ? demoRows : transcriptRows.value,
)

/** 会话头标题:取侧栏那条真实会话的标题 */
const currentTitle = computed(
  () => sessions.value.find((s) => s.id === selectedId.value)?.title || '未选择会话',
)

const userMessages = computed<UserMessage[]>(() => {
  const out: UserMessage[] = []
  renderRows.value.forEach((r, i) => {
    if (r.kind === 'user') out.push({ index: i, text: r.text, time: r.time })
  })
  return out
})

/* ── 发送 ─────────────────────────────────────── */
async function onSend() {
  const text = draft.value.trim()
  if (!text || !connected.value) return
  draft.value = ''
  stickToBottom.value = true
  await sendPrompt(text)
  void nextTick(() => scrollToBottom())
}

/** 中断当前回合 */
async function onStop() {
  await interruptTurn()
}

/** 空会话:用于把空态在消息区里垂直居中 */
const isBlank = computed(() => !isDemo.value && !transcriptLoading.value && renderRows.value.length === 0)

/* ── 消息导航 ─────────────────────────────────── */
const msgPickerOpen = ref(false)
const canPrev = computed(() => cursor.value > 0)
const canNext = computed(() => cursor.value >= 0 && cursor.value < renderRows.value.length - 1)

function jumpTo(index: number) {
  const nodes = transcriptEl.value?.querySelectorAll<HTMLElement>('.message')
  if (!nodes?.length) return
  cursor.value = Math.max(0, Math.min(nodes.length - 1, index))
  const el = nodes[cursor.value]
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  el.classList.add('jump-flash')
  window.setTimeout(() => el.classList.remove('jump-flash'), 900)
}

function jumpToMessage(index: number) {
  msgPickerOpen.value = false // 定位后关掉面板,别让它盖着刚跳过去的消息
  jumpTo(index)
}

</script>

<template>
  <div class="conversation">
    <!-- 会话头 -->
    <header class="conversation-head">
      <div class="conversation-title">
        <h1>{{ currentTitle }}</h1>
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

    <!-- 消息流舞台 -->
    <div ref="stageEl" class="chat-stage">
      <section
        ref="transcriptEl"
        class="transcript"
        :class="{ blank: isBlank }"
        @scroll.passive="onTranscriptScroll"
      >
        <div class="chat-col">
          <!-- 载入 / 失败 / 空态,正常有消息时才显示日期分隔 -->
          <div v-if="transcriptLoading" class="transcript-hint">正在载入历史…</div>
          <div v-else-if="loadError" class="transcript-hint error">读取历史失败:{{ loadError }}</div>
          <div v-else-if="renderRows.length === 0" class="blank-state">
            <div class="blank-mark">H</div>
            <strong>还没有消息</strong>
            <span>在下面描述你的任务,Hermes 会边执行边把过程写在这里。</span>
          </div>
          <template v-else>
            <div class="date-divider">今天</div>
            <div v-if="omitted" class="transcript-hint">更早的消息已被内核省略</div>
          </template>

          <!-- 消息行:预览示例与真实数据走同一渲染 -->
          <article v-for="row in renderRows" :key="row.key" class="message" :class="row.kind">
            <div class="message-avatar">
              {{ row.kind === 'user' ? '你' : row.kind === 'assistant' ? 'H' : row.kind === 'tool' ? '⚙' : '!' }}
            </div>
            <div class="message-body">
              <!-- 工具行的名字/状态在折叠头里,不再占一行 meta -->
              <div v-if="row.kind !== 'tool'" class="message-meta">
                <span class="message-name">
                  {{ row.kind === 'user' ? '你' : row.kind === 'assistant' ? 'Hermes' : '系统' }}
                </span>
                <span v-if="row.time">{{ row.time }}</span>
                <span v-if="isDemo" class="demo-tag">示例</span>
              </div>

              <!-- 推理:默认折叠,不属于对话正文 -->
              <div v-if="row.kind === 'assistant' && row.reasoning" class="collapse">
                <button class="collapse-head" type="button" @click="toggleBlock(row.key)">
                  <ChevronRight :size="12" class="chev" :class="{ open: isOpen(row.key) }" />
                  <span>{{ row.streaming && !row.text ? '思考中…' : '思考过程' }}</span>
                </button>
                <div v-show="isOpen(row.key)" class="collapse-body reasoning-text">{{ row.reasoning }}</div>
              </div>

              <!-- 助手正文:markdown 渲染(已消毒) -->
              <div v-if="row.kind === 'assistant' && (row.text || !row.reasoning)" class="message-text md">
                <span v-html="renderMarkdown(row.text)"></span><span v-if="row.streaming" class="caret">▍</span>
              </div>

              <!-- 用户消息:纯文本 -->
              <div v-else-if="row.kind === 'user'" class="message-text">{{ row.text }}</div>

              <!-- 系统提示(错误/中断):纯文本 -->
              <div v-else-if="row.kind === 'system'" class="message-text">{{ row.text }}</div>

              <!-- 工具调用:一行摘要,点开看参数与返回 -->
              <div v-else-if="row.kind === 'tool'" class="collapse">
                <button class="collapse-head" type="button" @click="toggleBlock(row.key)">
                  <ChevronRight :size="12" class="chev" :class="{ open: isOpen(row.key) }" />
                  <span class="tool-name">{{ row.name || '工具' }}</span>
                  <span v-if="row.context" class="tool-ctx">{{ row.context }}</span>
                  <span v-if="row.running" class="tool-state running">执行中…</span>
                  <span v-else-if="row.duration != null" class="tool-state">{{ row.duration.toFixed(1) }}s</span>
                </button>
                <div v-show="isOpen(row.key)" class="collapse-body tool-detail">
                  <template v-if="row.args">
                    <div class="detail-label">参数</div>
                    <pre class="detail-pre">{{ row.args }}</pre>
                  </template>
                  <template v-if="row.result">
                    <div class="detail-label">返回</div>
                    <pre class="detail-pre">{{ row.result }}</pre>
                  </template>
                </div>
              </div>
            </div>
          </article>
        </div>
      </section>

      <!-- 调宽手柄:放在滚动区之外,长对话滚到任何位置都可见 -->
      <div class="chat-frame" aria-hidden="true">
        <div class="chat-handle left" role="separator" aria-label="调整对话宽度" @pointerdown="startResize($event, -1)" />
        <div class="chat-handle right" role="separator" aria-label="调整对话宽度" @pointerdown="startResize($event, 1)" />
      </div>

      <!-- 输入区 -->
      <div class="composer-wrap">
        <form class="composer" @submit.prevent="onSend">
          <textarea
            v-model="draft"
            rows="2"
            :placeholder="connected ? '继续描述你的任务…' : '未连接后端:先点顶部「连接」'"
            @keydown.enter.exact.prevent="onSend"
          />
          <div class="composer-foot">
            <span class="hint">
              <template v-if="submitStatus === 'queued'">已排队,等当前回合结束</template>
              <template v-else-if="submitStatus === 'steered'">已作为插话送出</template>
              <template v-else-if="turnActive">正在生成…</template>
              <template v-else-if="phase === 'starting'">正在启动 hermes serve…</template>
              <template v-else-if="!connected">Enter 发送 · 先连接后端</template>
              <template v-else>Enter 发送 · Shift+Enter 换行</template>
            </span>
            <!-- 生成中给「停止」;忙碌时仍可直接发送,内核会排队或按插话处理 -->
            <button
              v-if="turnActive"
              class="send stop"
              type="button"
              aria-label="停止生成"
              @click="onStop"
            >
              <Square :size="13" />
            </button>
            <button class="send" type="submit" :disabled="!connected || !draft.trim()">
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
            <button class="nav-btn" :disabled="!canPrev" aria-label="上一条" @click="jumpTo(cursor - 1)">
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
            <button class="nav-btn" :disabled="!canNext" aria-label="下一条" @click="jumpTo(cursor + 1)">
              <ChevronDown :size="15" />
            </button>
          </template>
          下一条
        </n-tooltip>

        <n-tooltip trigger="hover" placement="left">
          <template #trigger>
            <button class="nav-btn" aria-label="回到底部" @click="scrollToBottom(true)">
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

/* 调宽手柄层:是 .chat-stage 的直接子级(不随消息流滚动),
   长对话滚到中段也能看见并抓住手柄 */
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

/* ── 折叠块:思考过程与工具调用 ─────────────────── */
.collapse {
  border: 1px solid var(--border);
  border-radius: 9px;
  background: color-mix(in oklch, var(--fg) 2.5%, transparent);
  overflow: hidden;
}

.collapse-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  text-align: left;
}
.collapse-head:hover { color: var(--fg); }

.chev {
  flex: 0 0 auto;
  transition: transform 0.15s ease;
}
.chev.open { transform: rotate(90deg); }

.tool-name { color: var(--fg); font-weight: 500; font-size: 12px; }

.tool-ctx {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-state {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--muted);
  font: 10.5px var(--font-mono);
}
.tool-state.running { color: var(--warn); }

.collapse-body {
  padding: 2px 12px 10px;
  border-top: 1px solid var(--border);
}

.reasoning-text {
  color: var(--muted);
  font-size: 12.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.detail-label {
  margin: 8px 0 3px;
  color: var(--muted);
  font: 10px var(--font-mono);
  letter-spacing: 0.05em;
}

.detail-pre {
  margin: 0;
  max-height: 240px;
  overflow: auto;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--fg-soft);
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ── markdown 正文(助手回复)─────────────────────
   v-html 注入的节点不带 scoped 属性,深层选择一律走 :deep()。 */
.message-text.md { white-space: normal; }

.md :deep(p) { margin: 0 0 8px; }
.md :deep(> p:first-child, > div:first-child > p:first-child) { margin-top: 0; }
.md :deep(p:last-child) { margin-bottom: 0; }

.md :deep(h1), .md :deep(h2), .md :deep(h3), .md :deep(h4) {
  margin: 14px 0 6px;
  font-weight: 600;
  line-height: 1.4;
}
.md :deep(h1) { font-size: 17px; }
.md :deep(h2) { font-size: 15.5px; }
.md :deep(h3), .md :deep(h4) { font-size: 14px; }
.md :deep(> :first-child) { margin-top: 0; }

.md :deep(ul), .md :deep(ol) { margin: 6px 0; padding-left: 22px; }
.md :deep(li) { margin: 2px 0; }
.md :deep(li::marker) { color: var(--muted); }

.md :deep(code) {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--fg-soft);
  font-family: var(--font-mono);
  font-size: 12.5px;
}

.md :deep(pre) {
  margin: 8px 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--fg-soft);
  overflow-x: auto;
}
.md :deep(pre code) { padding: 0; background: transparent; font-size: 12px; line-height: 1.6; }

.md :deep(blockquote) {
  margin: 8px 0;
  padding: 2px 0 2px 11px;
  border-left: 2px solid color-mix(in oklch, var(--accent) 55%, var(--border));
  color: var(--muted);
}

.md :deep(table) {
  margin: 8px 0;
  border-collapse: collapse;
  font-size: 13px;
}
.md :deep(th), .md :deep(td) {
  padding: 5px 10px;
  border: 1px solid var(--border);
  text-align: left;
}
.md :deep(th) { background: var(--fg-soft); font-weight: 600; }

.md :deep(a) { color: var(--accent); text-decoration: none; }
.md :deep(a:hover) { text-decoration: underline; }

.md :deep(hr) {
  margin: 12px 0;
  border: 0;
  border-top: 1px solid var(--border);
}

.md :deep(img) { max-width: 100%; border-radius: 8px; }

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

/* 停止按钮:生成中出现在发送键左侧,用危险色区分 */
.send.stop {
  color: var(--danger);
  border-color: color-mix(in oklch, var(--danger) 40%, var(--border));
}

.send.stop:hover { background: color-mix(in oklch, var(--danger) 12%, transparent); }

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
  position: relative;   /* 计数徽标要相对按钮定位,否则会跑到整条导航条的角上 */
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  transition: background 0.13s, color 0.13s, opacity 0.13s;
}
.nav-btn:hover:not(:disabled) { background: var(--fg-soft); color: var(--fg); }
/* 到头/到底时禁用,避免「下一条」绕回顶部的错觉 */
.nav-btn:disabled { opacity: 0.28; cursor: default; }

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

.jump-flash :deep(.message-text),
.jump-flash :deep(.collapse) { background: var(--accent-soft); }

/* 载入 / 已省略提示:居中一行小字,不占满整个消息区 */
.transcript-hint {
  margin: 10px auto;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
}

.transcript-hint.error { color: var(--danger); }
</style>

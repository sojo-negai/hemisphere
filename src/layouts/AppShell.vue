<script setup lang="ts">
// 应用外壳:标题栏 + 侧栏 + 主区(路由出口) + 状态栏。
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NDropdown, NInput, NModal, NPopover, NTooltip, useMessage } from 'naive-ui'
import {
  Archive, Bell, Blocks, Check, ChevronRight, Download, ListFilter, LoaderCircle,
  MessageSquare, Moon, Plus, Search, Settings, Sun, X,
} from 'lucide-vue-next'
import ArchiveDialog from '../components/ArchiveDialog.vue'
import { mod } from '../lib/platform'
import WorkspaceDialog from '../components/WorkspaceDialog.vue'
import { activeProfile } from '../stores/profiles'
import {
  archiveSession, branchSession, deleteSession, noteEvent, projects, refreshAll,
  renameSession, sessions, sessionsError, STATUS_LABEL, type SessionStatus,
} from '../stores/sessions'
import {
  backendInfo, connected, items, phase, reconnectAttempt, sessionId, subscribeEvents,
} from '../stores/connection'
import type { GatewayEvent } from '../lib/gateway-client'
import { useAppTheme } from '../theme'

const route = useRoute()
const router = useRouter()
const { isDark, setMode } = useAppTheme()

/* ── 日/夜间模式:单键切换(不做下拉) ─────────────── */
function toggleTheme() {
  setMode(isDark.value ? 'light' : 'dark')
}

/* ── 检查更新 ─────────────────────────────────── */
const checkingUpdate = ref(false)
async function checkUpdate() {
  if (checkingUpdate.value) return
  checkingUpdate.value = true
  await new Promise((r) => setTimeout(r, 900))
  checkingUpdate.value = false
}

/* ── 工作区/档案:点击打开一站式管理弹窗 ─────────── */
const workspaceDialog = ref(false)

/* ── 已归档对话 ───────────────────────────────── */
const archiveDialog = ref(false)

/* ── 侧栏导航 ─────────────────────────────────── */
const navItems = [
  { key: 'conversation', label: '对话', icon: MessageSquare, to: '/conversation' },
  { key: 'capabilities', label: '能力', icon: Blocks, to: '/capabilities' },
]

/* ── 会话筛选与列表 ───────────────────────────── */
type Filter = 'recent' | 'project' | 'platform'
const filter = ref<Filter>('recent')
const filters: { key: Filter; label: string }[] = [
  { key: 'recent', label: '最近' },
  { key: 'project', label: '项目' },
  { key: 'platform', label: '平台' },
]

/** 当前选中的会话;真实列表是异步拉取的,初始为空,拉到数据后取第一条 */
const selectedSession = ref('')

/* ── 搜索:仅匹配标题 ─────────────────────────── */
const searchOpen = ref(false)
const query = ref('')
const searchInput = ref<HTMLInputElement | null>(null)

async function toggleSearch() {
  searchOpen.value = !searchOpen.value
  if (searchOpen.value) {
    await nextTick()
    searchInput.value?.focus()
  } else {
    query.value = ''
  }
}

/* ── 状态筛选(红/黄/绿三态) ──────────────────── */
const statusFilter = ref<SessionStatus | 'all'>('all')

/** 只经过搜索筛的集合:状态菜单的计数基于它,才能反映“可选多少” */
const searchedSessions = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q ? sessions.value.filter((s) => s.title.toLowerCase().includes(q)) : sessions.value
})

/** 状态面板的开启状态 */
const statusMenuOpen = ref(false)

/**
 * 状态面板的行数据:颜色点与卡片右下角的指示灯同色,
 * 计数基于「搜索命中」的集合,表示该状态下还有多少可选。
 */
const statusRows = computed(() => {
  const base = searchedSessions.value
  const count = (st: SessionStatus) => base.filter((s) => s.status === st).length
  return [
    { key: 'all' as const, label: '全部状态', tone: 'all', count: base.length },
    ...(['ok', 'confirm', 'error', 'none'] as SessionStatus[]).map((k) => ({
      key: k,
      label: STATUS_LABEL[k],
      tone: k,
      count: count(k),
    })),
  ]
})

function pickStatus(key: SessionStatus | 'all') {
  statusFilter.value = key
  statusMenuOpen.value = false
}

function clearStatusFilter() {
  statusFilter.value = 'all'
}

const statusFilterActive = computed(() => statusFilter.value !== 'all')
const statusFilterLabel = computed(() =>
  statusFilterActive.value ? STATUS_LABEL[statusFilter.value as SessionStatus] : '全部状态',
)

/** 最终可见的会话:搜索 → 状态筛选 */
const visibleSessions = computed(() => {
  const base = searchedSessions.value
  return statusFilterActive.value
    ? base.filter((s) => s.status === statusFilter.value)
    : base
})

/** 筛选标签上的计数 */
const filterCounts = computed<Record<Filter, number>>(() => ({
  recent: visibleSessions.value.length,
  project: new Set(visibleSessions.value.map((s) => s.project)).size,
  platform: new Set(visibleSessions.value.map((s) => s.platform)).size,
}))

/** 状态指示灯语义 */
const statusLabel = (st: SessionStatus) => STATUS_LABEL[st]

// 按「项目」或「平台」分组;「最近」为平铺列表
const grouped = computed(() => {
  if (filter.value === 'recent') {
    return [{ name: '', rows: visibleSessions.value }]
  }
  const field = filter.value === 'project' ? 'project' : 'platform'
  const buckets = new Map<string, typeof sessions.value>()
  for (const s of visibleSessions.value) {
    const k = s[field]
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k)!.push(s)
  }
  return [...buckets.entries()].map(([name, rows]) => ({ name, rows }))
})

function pickSession(id: string) {
  selectedSession.value = id
  if (route.path !== '/conversation') void router.push('/conversation')
}

/* ── 会话右键菜单(含二级子菜单) ─────────────── */
const DANGER_STYLE = { color: 'var(--danger)' }

const ctx = reactive({ show: false, x: 0, y: 0, id: '' })

function openSessionMenu(e: MouseEvent, id: string) {
  ctx.id = id
  ctx.x = e.clientX
  ctx.y = e.clientY
  ctx.show = true
}

const ctxOptions = computed(() => [
  { label: '打开会话', key: 'open' },
  { label: '重命名', key: 'rename' },
  { label: '分支对话', key: 'branch' },
  { type: 'divider', key: 'd1' },
  {
    // 二级菜单:项目清单来自内核 projects.tree
    label: '移动到项目',
    key: 'move',
    children: projects.value.length
      ? projects.value.slice(0, 8).map((p) => ({ label: p.name, key: `move:${p.id}` }))
      : [{ label: '暂无项目', key: 'move:none', disabled: true }],
  },
  { label: '复制会话 id', key: 'copy' },
  { type: 'divider', key: 'd2' },
  { label: '归档', key: 'archive' },
  {
    label: '删除会话',
    key: 'delete',
    props: { style: DANGER_STYLE, class: 'danger-option' },
  },
])

/** 真实动作:成功/失败都给明确反馈(不是「待接入」占位) */
async function onSessionMenuSelect(key: string) {
  ctx.show = false
  const row = sessions.value.find((s) => s.id === ctx.id)
  if (!row) return
  try {
    if (key === 'open') {
      pickSession(row.id)
    } else if (key === 'rename') {
      renameTarget.value = row
      renameValue.value = row.title
    } else if (key === 'branch') {
      const created = await branchSession(row.id)
      if (created) {
        pickSession(created)
        message.success(`已分支出新会话：${row.title}`)
      }
    } else if (key === 'archive') {
      await archiveSession(row.id)
      message.success(`已归档「${row.title}」`)
    } else if (key === 'delete') {
      await deleteSession(row.id)
      message.warning(`已删除「${row.title}」`)
    } else if (key === 'copy') {
      await navigator.clipboard?.writeText(row.id)
      message.success('已复制会话 id')
    } else if (key.startsWith('move:')) {
      message.info('内核暂未提供「会话改项目」的方法,该动作待接入')
    }
  } catch (e) {
    message.error(`操作失败：${String(e)}`)
  }
}

/* ── 重命名弹窗 ───────────────────────────────── */
const renameTarget = ref<(typeof sessions.value)[number] | null>(null)
const renameValue = ref('')

async function commitRename() {
  const row = renameTarget.value
  const title = renameValue.value.trim()
  if (!row || !title) return
  try {
    await renameSession(row.id, title)
    renameTarget.value = null
    message.success('已重命名')
  } catch (e) {
    message.error(`重命名失败：${String(e)}`)
  }
}

/* ── 通知 ─────────────────────────────────────── */
// 数据暂为示例;后续接 gateway 事件(background.complete / approval.request 等)
const notices = ref([
  { id: 1, title: '后台任务已完成：检查 Tauri 2 窗口通信方案', time: '2 分钟前', unread: true },
  { id: 2, title: '工具调用等待确认：终端命令', time: '12 分钟前', unread: true },
])
const unread = computed(() => notices.value.filter((n) => n.unread).length)
function readAll() {
  notices.value.forEach((n) => { n.unread = false })
}

/* ── 状态栏 ───────────────────────────────────── */
const statusText = computed(() => {
  if (connected.value) return '已连接'
  if (phase.value === 'starting') return '连接中…'
  if (phase.value === 'disconnected') {
    return reconnectAttempt.value ? `已断开 · 重连中(${reconnectAttempt.value})` : '已断开'
  }
  if (phase.value === 'error') return '连接失败'
  return '未连接'
})

/** 后端标识:显示真实端口,便于排查(未连接时给出提示) */
const backendLabel = computed(() =>
  backendInfo.value ? `127.0.0.1:${backendInfo.value.port}` : '未启动',
)

/** 当前会话摘要 */
const sessionLabel = computed(() => {
  if (!sessionId.value) return '尚未创建会话'
  return `会话 ${sessionId.value.slice(0, 12)} · ${items.length} 条消息`
})

/* ── 数据装载 ─────────────────────────────────── */
const message = useMessage()

onMounted(async () => {
  // 事件 → 状态灯(黄=等你确认、红=出错、绿=正常结束)与会话列表刷新
  subscribeEvents((e: GatewayEvent) => noteEvent(e))
  if (connected.value) await refreshAll()
  if (!selectedSession.value && sessions.value[0]) selectedSession.value = sessions.value[0].id
})

// 内核是在挂载之后才连上的(启动门禁),连上就补拉一次
watch(connected, (ok) => {
  if (ok) void refreshAll()
})
</script>

<template>
  <div class="app">
    <!-- 标题栏(暂用系统窗口边框,故不画交通灯;改成无边框后这里即拖拽区) -->
    <header class="titlebar">
      <div class="brand">
        <span class="brand-mark">H</span>
        <span>Hemisphere</span>
      </div>
      <div class="spacer" />
      <!-- 连接状态:纯展示,不可点击、无悬浮提示 -->
      <span class="connection">
        <span class="status-dot" :class="{ ok: connected }" />
        <span>{{ statusText }}</span>
      </span>
      <n-popover trigger="click" placement="bottom-end" :style="{ padding: 0 }">
        <template #trigger>
          <button class="icon-btn notify" aria-label="通知">
            <Bell :size="16" />
            <span v-if="unread" class="notify-badge">{{ unread }}</span>
          </button>
        </template>
        <div class="notify-panel">
          <div class="notify-head">
            <strong>通知</strong>
            <button v-if="unread" class="notify-clear" @click="readAll">全部已读</button>
          </div>
          <div v-if="!notices.length" class="notify-empty">暂无通知</div>
          <button v-for="n in notices" :key="n.id" class="notify-row" @click="n.unread = false">
            <span class="notify-dot" :class="{ on: n.unread }" />
            <span class="notify-copy">
              <strong>{{ n.title }}</strong>
              <small>{{ n.time }}</small>
            </span>
          </button>
        </div>
      </n-popover>

      <n-tooltip trigger="hover">
        <template #trigger>
          <button class="icon-btn" aria-label="检查更新" :disabled="checkingUpdate" @click="checkUpdate">
            <LoaderCircle v-if="checkingUpdate" :size="16" class="spin" />
            <Download v-else :size="16" />
          </button>
        </template>
        {{ checkingUpdate ? '正在检查更新…' : '检查更新' }}
      </n-tooltip>
      <n-tooltip trigger="hover">
        <template #trigger>
          <button class="icon-btn" aria-label="切换日间/夜间模式" @click="toggleTheme">
            <component :is="isDark ? Moon : Sun" :size="16" />
          </button>
        </template>
        {{ isDark ? '切换到日间模式' : '切换到夜间模式' }}
      </n-tooltip>
      <n-tooltip trigger="hover">
        <template #trigger>
          <button class="icon-btn" aria-label="打开设置" @click="router.push('/settings')">
            <Settings :size="16" />
          </button>
        </template>
        设置
      </n-tooltip>
    </header>

    <div class="workspace">
      <!-- 侧栏 -->
      <aside class="sidebar">
        <button class="workspace-button" @click="workspaceDialog = true">
          <span class="workspace-glyph">{{ activeProfile.name.slice(0, 1) }}</span>
          <span class="workspace-copy">
            <strong>{{ activeProfile.name }}</strong>
            <small>{{ activeProfile.mode }}</small>
          </span>
          <ChevronRight :size="15" class="workspace-chevron" />
        </button>

        <button class="new-chat">
          <span class="new-chat-glyph"><Plus :size="14" /></span>
          <span class="new-chat-label">开始新对话</span>
          <kbd class="new-chat-kbd">{{ mod('N') }}</kbd>
        </button>

        <nav class="nav-list" aria-label="主导航">
          <button
            v-for="item in navItems"
            :key="item.key"
            class="nav-item"
            :class="{ active: route.path === item.to && route.name === item.key }"
            @click="router.push(item.to)"
          >
            <component :is="item.icon" :size="15" />
            <span>{{ item.label }}</span>
          </button>
        </nav>

        <section class="sidebar-section">
          <!-- 搜索框(由导航行的搜索图标唤起,仅匹配标题) -->
          <div v-if="searchOpen" class="search-row">
            <Search :size="13" class="search-glyph" />
            <input
              ref="searchInput"
              v-model="query"
              class="search-input"
              placeholder="搜索对话标题…"
              @keydown.esc="toggleSearch"
            />
            <button class="search-clear" aria-label="关闭搜索" @click="toggleSearch">
              <X :size="12" />
            </button>
          </div>

          <!-- 文字式分段:下划线指示当前筛选,带计数;右端是对话搜索入口 -->
          <div class="session-filter" role="tablist">
            <button
              v-for="f in filters"
              :key="f.key"
              :class="{ active: filter === f.key }"
              role="tab"
              @click="filter = f.key"
            >
              <span>{{ f.label }}</span>
              <span class="f-count">{{ filterCounts[f.key] }}</span>
            </button>
            <span class="filter-actions">
              <button
                class="filter-btn"
                :class="{ on: searchOpen }"
                title="搜索对话"
                aria-label="搜索对话"
                @click="toggleSearch"
              >
                <Search :size="13" />
              </button>
              <n-popover
                v-model:show="statusMenuOpen"
                trigger="click"
                placement="bottom-end"
                :show-arrow="false"
                :style="{ padding: 0 }"
              >
                <template #trigger>
                  <button
                    class="filter-btn"
                    :class="{ on: statusFilterActive }"
                    title="按会话状态筛选"
                    aria-label="按会话状态筛选"
                  >
                    <ListFilter :size="13" />
                    <span v-if="statusFilterActive" class="filter-dot" />
                  </button>
                </template>

                <!-- 状态筛选面板:色点与卡片指示灯同色,计数右对齐,当前项高亮 -->
                <div class="status-panel">
                  <div class="sp-head">
                    <span>按状态筛选</span>
                    <button v-if="statusFilterActive" class="sp-clear" @click="clearStatusFilter">
                      清除
                    </button>
                  </div>
                  <button
                    v-for="r in statusRows"
                    :key="r.key"
                    class="sp-row"
                    :class="{ active: statusFilter === r.key, zero: r.count === 0 }"
                    :aria-pressed="statusFilter === r.key"
                    @click="pickStatus(r.key)"
                  >
                    <span class="sp-dot" :class="r.tone" />
                    <span class="sp-label">{{ r.label }}</span>
                    <span class="sp-count">{{ r.count }}</span>
                    <span class="sp-check" :class="{ on: statusFilter === r.key }">
                      <Check :size="13" />
                    </span>
                  </button>
                </div>
              </n-popover>

              <button
                class="filter-btn"
                title="已归档对话"
                aria-label="已归档对话"
                @click="archiveDialog = true"
              >
                <Archive :size="13" />
              </button>
            </span>
          </div>

          <div class="session-scroll">
            <template v-for="(group, gi) in grouped" :key="gi">
              <div v-if="group.name" class="session-group">
                <span>{{ group.name }}</span>
                <span class="g-count">{{ group.rows.length }}</span>
              </div>
              <button
                v-for="s in group.rows"
                :key="s.id"
                class="session"
                :class="{ selected: s.id === selectedSession }"
                @click="pickSession(s.id)"
                @contextmenu.prevent="openSessionMenu($event, s.id)"
              >
                <span class="session-top">
                  <span class="session-title">{{ s.title }}</span>
                  <span class="session-time">{{ s.time }}</span>
                </span>
                <!-- 特性展示:来源平台 + 所属项目(不再用色点与胶囊标签) -->
                <span class="session-sub">
                  <span class="session-platform">{{ s.platform }}</span>
                  <span class="sub-sep">·</span>
                  <span class="session-project">{{ s.project }}</span>
                </span>
                <!-- 状态灯:卡片右下角;内核里活着时会呼吸 -->
                <span
                  class="lamp"
                  :class="[s.status, { live: s.live }]"
                  :title="s.live ? `${statusLabel(s.status)}(内核中运行中)` : statusLabel(s.status)"
                  :aria-label="statusLabel(s.status)"
                />
              </button>
            </template>
            <p v-if="sessionsError" class="session-empty">读取会话失败：{{ sessionsError }}</p>
            <p v-else-if="!connected" class="session-empty">未连接到内核,暂不能读取会话列表</p>
            <p v-else-if="!grouped.some((g) => g.rows.length)" class="session-empty">
              <template v-if="query && statusFilterActive">
                没有同时匹配「{{ query }}」且状态为「{{ statusFilterLabel }}」的对话
              </template>
              <template v-else-if="query">没有匹配「{{ query }}」的对话</template>
              <template v-else-if="statusFilterActive">没有状态为「{{ statusFilterLabel }}」的对话</template>
              <template v-else>内核里还没有会话</template>
            </p>
          </div>

          <!-- 重命名会话 -->
          <n-modal
            :show="!!renameTarget"
            preset="card"
            :style="{ width: '420px' }"
            :bordered="false"
            title="重命名会话"
            @update:show="(v: boolean) => { if (!v) renameTarget = null }"
          >
            <n-input
              v-model:value="renameValue"
              placeholder="会话标题"
              @keydown.enter="commitRename"
            />
            <template #footer>
              <div class="modal-foot">
                <button class="ghost-btn" @click="renameTarget = null">取消</button>
                <button class="primary-btn" @click="commitRename">保存</button>
              </div>
            </template>
          </n-modal>

          <!-- 会话右键菜单:manual 触发 + 鼠标坐标定位;删除项危险色 -->
          <n-dropdown
            trigger="manual"
            placement="bottom-start"
            :show="ctx.show"
            :x="ctx.x"
            :y="ctx.y"
            :options="ctxOptions"
            @select="onSessionMenuSelect"
            @clickoutside="ctx.show = false"
          />
        </section>

      </aside>

      <!-- 主区 -->
      <main class="main">
        <router-view />
      </main>
    </div>

    <!-- 状态栏:连接 / 后端 / 会话 三组真实信息 + 会话详情弹层 -->
    <footer class="statusbar">
      <span class="status-item">
        <span class="status-dot" :class="{ ok: connected }" />
        {{ statusText }}
      </span>
      <span class="status-item">
        内核 <strong>hermes serve</strong>
        <span class="dim">{{ backendLabel }}</span>
      </span>
      <span class="status-item">{{ sessionLabel }}</span>
      <span class="spacer" />
      <n-popover trigger="click" placement="top-end" :style="{ padding: 0 }">
        <template #trigger>
          <button class="status-action">会话详情</button>
        </template>
        <div class="detail-panel">
          <div class="detail-row"><span>连接状态</span><strong>{{ statusText }}</strong></div>
          <div class="detail-row"><span>会话 ID</span><strong>{{ sessionId || '—' }}</strong></div>
          <div class="detail-row"><span>消息条数</span><strong>{{ items.length }}</strong></div>
          <div class="detail-row"><span>后端端口</span><strong>{{ backendInfo ? backendInfo.port : '—' }}</strong></div>
          <div class="detail-row detail-wrap">
            <span>WS 地址</span><strong>{{ backendInfo ? backendInfo.ws_url.replace(/token=.*/, 'token=***') : '—' }}</strong>
          </div>
        </div>
      </n-popover>
      <span class="status-item">{{ activeProfile.name }}</span>
    </footer>

    <!-- 工作区/档案管理弹窗(一站式 profile 管理) -->
    <workspace-dialog v-model:show="workspaceDialog" />

    <!-- 已归档对话列表 -->
    <archive-dialog v-model:show="archiveDialog" />
  </div>
</template>

<style scoped>
/* ── 外壳骨架 ─────────────────────────────── */
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
  color: var(--fg);
}

.titlebar {
  height: var(--titlebar-h);
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in oklch, var(--surface) 94%, transparent);
  backdrop-filter: blur(14px);
}

.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.brand-mark {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: 1px solid var(--fg);
  border-radius: 7px;
  font: 10px var(--font-mono);
}

.spacer { flex: 1; }

.connection {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 28px;
  padding: 0 11px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: color-mix(in oklch, var(--surface) 70%, transparent);
  color: var(--muted);
  font-size: 12px;
  cursor: default;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--muted);
}
.status-dot.ok {
  background: var(--ok);
}

.icon-btn {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
  color: var(--muted);
  border-radius: 7px;
}
.icon-btn:hover {
  background: var(--fg-soft);
  color: var(--fg);
}

/* 通知按钮:有未读时凸显 + 轻微呼吸,不打扰 */
.notify { position: relative; }
.notify:has(.notify-badge) { color: var(--fg); }

.notify-badge {
  position: absolute;
  top: 3px;
  right: 3px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font: 9px/14px var(--font-mono);
  text-align: center;
  animation: notify-pulse 2.4s ease-in-out infinite;
}

@keyframes notify-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklch, var(--accent) 45%, transparent); }
  60% { box-shadow: 0 0 0 5px color-mix(in oklch, var(--accent) 0%, transparent); }
}

.notify-panel { width: 300px; }

.notify-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 13px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}

.notify-clear {
  border: 0;
  background: transparent;
  color: var(--accent);
  font-size: 11px;
}
.notify-clear:hover { text-decoration: underline; }

.notify-empty {
  padding: 22px 13px;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
}

.notify-row {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 10px 13px;
  border: 0;
  background: transparent;
  color: var(--fg);
  text-align: left;
}
.notify-row:hover { background: var(--fg-soft); }

.notify-dot {
  width: 6px;
  height: 6px;
  margin-top: 5px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--border);
}
.notify-dot.on { background: var(--accent); }

.notify-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.notify-copy strong { font-size: 12px; font-weight: 500; line-height: 1.45; }
.notify-copy small { color: var(--muted); font-size: 10px; }

.workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: var(--rail) minmax(0, 1fr);
}

/* ── 侧栏 ─────────────────────────────────── */
.sidebar {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 12px 14px;
  background: var(--surface);
  border-right: 1px solid var(--border);
}

.sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
}

.workspace-button {
  flex: 0 0 auto; /* 侧栏是纵向 flex,禁止收缩,否则固定高度会被压扁 */
  width: 100%;
  height: 54px;
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: color-mix(in oklch, var(--surface) 92%, var(--bg));
  color: var(--fg);
  text-align: left;
  transition: border-color 0.15s, background 0.15s;
}
.workspace-button:hover {
  border-color: color-mix(in oklch, var(--accent) 45%, var(--border));
  background: var(--surface);
}

.workspace-chevron {
  flex: 0 0 auto;
  color: var(--muted);
  transition: transform 0.15s;
}
.workspace-button:hover .workspace-chevron { transform: translateX(2px); color: var(--accent); }

.workspace-glyph {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: var(--fg);
  color: var(--surface);
  font: 11px var(--font-mono);
}

.workspace-copy { flex: 1; min-width: 0; }
.workspace-copy strong {
  display: block;
  font-size: 13.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workspace-copy small {
  display: block;
  margin-top: 1px;
  color: var(--muted);
  font-size: 10.5px;
}

.new-chat {
  flex: 0 0 auto;
  width: 100%;
  height: 44px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  color: var(--fg);
  font-size: 13px;
  transition: border-color 0.15s, background 0.15s;
}
.new-chat:hover { border-color: color-mix(in oklch, var(--accent) 45%, var(--border)); }

/* 图标落在圆形浅底里,比整块染色克制 */
.new-chat-glyph {
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent);
}

.new-chat-label { flex: 1; text-align: left; font-weight: 550; }

.new-chat-kbd {
  flex: 0 0 auto;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--muted);
  font: 10px var(--font-mono);
}

.nav-list {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.search-row {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface);
  margin-bottom: 2px;
}
.search-row:focus-within { border-color: color-mix(in oklch, var(--accent) 50%, var(--border)); }

.search-glyph { flex: 0 0 auto; color: var(--muted); }

.search-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--fg);
  font-size: 12.5px;
}
.search-input::placeholder { color: var(--muted); }

.search-clear {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
}
.search-clear:hover { background: var(--fg-soft); color: var(--fg); }

.nav-item {
  height: 34px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  font-size: 13px;
  text-align: left;
}
.nav-item:hover { background: var(--fg-soft); color: var(--fg); }
.nav-item.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

.sidebar-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  flex: 1 1 auto;
}

.session-filter {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 6px 6px 9px;
  border-bottom: 1px solid var(--border);
}

.session-filter button {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 0 7px;
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  transition: color 0.15s;
}
.session-filter button:hover { color: var(--fg); }

.session-filter button.active { color: var(--fg); font-weight: 600; }

/* 下划线指示器:比整块底色更轻 */
.session-filter button.active::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: var(--accent);
}

.f-count {
  padding: 0 5px;
  border-radius: 999px;
  background: var(--fg-soft);
  color: var(--muted);
  font: 9.5px/15px var(--font-mono);
}
.session-filter button.active .f-count {
  background: var(--accent-soft);
  color: var(--accent);
}

.filter-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
}

.session-filter button.filter-btn {
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  opacity: 0.65;
  transition: opacity 0.13s, background 0.13s, color 0.13s;
}
.session-filter button.filter-btn::after { content: none; }
.session-filter button.filter-btn:hover,
.session-filter button.filter-btn.on {
  opacity: 1;
  background: var(--fg-soft);
  color: var(--fg);
}
.session-filter button.filter-btn.on { color: var(--accent); }

.session-filter button.filter-btn svg { display: block; }

/* ── 状态筛选面板 ───────────────────────────────── */
.status-panel {
  min-width: 186px;
  padding: 6px;
}
.sp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px 7px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--border);
  color: var(--muted);
  font-size: 10.5px;
  letter-spacing: 0.03em;
}
.sp-clear {
  border: 0;
  background: transparent;
  color: var(--accent);
  font-size: 10.5px;
  cursor: pointer;
  padding: 0;
}
.sp-clear:hover { text-decoration: underline; }

.sp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--fg);
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}
.sp-row:hover { background: var(--fg-soft); }
.sp-row.active { background: var(--accent-soft); color: var(--accent); }
.sp-row.active .sp-label { font-weight: 600; }
/* 该状态下没有会话:压暗但仍可点(便于确认“确实没有”) */
.sp-row.zero:not(.active) { opacity: 0.42; }

.sp-dot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.sp-dot.all { background: color-mix(in oklch, var(--fg) 32%, transparent); }
.sp-dot.ok { background: var(--ok); }
.sp-dot.confirm { background: var(--warn); }
.sp-dot.error { background: var(--danger); }

.sp-label { flex: 1 1 auto; }
.sp-count {
  color: var(--muted);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}
.sp-row.active .sp-count { color: var(--accent); }

/* 勾选位固定宽,避免切换时行内容左右跳动 */
.sp-check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  flex: 0 0 auto;
  color: var(--accent);
  opacity: 0;
}
.sp-check.on { opacity: 1; }

/* 筛选生效时:按钮常亮 + 右上角小圆点,避免“看起来没筛” */
.session-filter button.filter-btn { position: relative; }
.session-filter button.filter-btn.on {
  background: var(--accent-soft);
  color: var(--accent);
  opacity: 1;
}
.filter-dot {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
}

.session-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.session-group {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 12px 9px 4px;
  color: var(--muted);
  font: 10px var(--font-mono);
  letter-spacing: 0.04em;
}
.session-group .g-count { margin-left: auto; opacity: 0.75; }

.session {
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 9px 10px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--fg);
  text-align: left;
  transition: background 0.13s;
}
.session:hover { background: var(--fg-soft); }
.session.selected {
  background: var(--accent-soft);
  box-shadow: inset 2px 0 0 var(--accent);
}

.session-top {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.session-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.8px;
  font-weight: 500;
}
.session.selected .session-title { font-weight: 600; }

.session-time {
  flex: 0 0 auto;
  color: var(--muted);
  font-size: 10.5px;
}

.session-sub {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--muted);
  font-size: 11px;
  min-width: 0;
  padding-right: 16px; /* 给右下角指示灯让位 */
}

.session-platform {
  flex: 0 0 auto;
  color: color-mix(in oklch, var(--muted) 85%, var(--fg));
}

.sub-sep { opacity: 0.5; }

.session-project {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lamp {
  position: absolute;
  right: 10px;
  bottom: 9px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.lamp.ok { background: var(--ok); }
.lamp.confirm {
  background: var(--warn);
  animation: lamp-pulse 2s ease-in-out infinite;
}
.lamp.error { background: var(--danger); }
/* 无实时信号的历史会话:静默灰点,不硬凑成绿灯 */
.lamp.none { background: color-mix(in oklch, var(--muted) 50%, transparent); }
/* 内核里还活着但没有明确结果的会话:让灰点呼吸,表示「正在进行」 */
.lamp.none.live { animation: lamp-idle-pulse 1.8s ease-in-out infinite; }

@keyframes lamp-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklch, var(--warn) 45%, transparent); }
  60% { box-shadow: 0 0 0 4px color-mix(in oklch, var(--warn) 0%, transparent); }
}

@keyframes lamp-idle-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

.modal-foot { display: flex; justify-content: flex-end; gap: 8px; }
.ghost-btn {
  height: 30px;
  padding: 0 13px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--fg);
  font-size: 12px;
}
.ghost-btn:hover { border-color: var(--accent); color: var(--accent); }
.primary-btn {
  height: 30px;
  padding: 0 15px;
  border: 0;
  border-radius: 8px;
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
}

.session-empty {
  margin: 14px 9px;
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.6;
}

.main {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

/* 路由视图占满主区(不让内容把输入区挤出视口) */
.main > :deep(*) {
  flex: 1 1 auto;
  min-height: 0;
}

/* ── 状态栏 ───────────────────────────────── */
.statusbar {
  height: var(--statusbar-h);
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  border-top: 1px solid var(--border);
  background: var(--surface);
  color: var(--muted);
  font-size: 11px;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 6px;
}
.status-item strong { color: var(--fg); font-weight: 600; }

.status-action {
  border: 0;
  background: transparent;
  color: var(--accent);
  font-size: 11px;
}
.status-action:hover { text-decoration: underline; }

.dim { color: color-mix(in oklch, var(--muted) 70%, transparent); }

/* 会话详情弹层 */
.detail-panel {
  width: 320px;
  padding: 4px 0;
}
.detail-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 7px 13px;
  font-size: 12px;
}
.detail-row span { color: var(--muted); }
.detail-row strong { font-weight: 500; }
.detail-wrap { flex-direction: column; align-items: flex-start; gap: 3px; }
.detail-wrap strong { font: 11px var(--font-mono); word-break: break-all; color: var(--muted); }

/* 检查更新按钮的旋转态 */
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>

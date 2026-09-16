<script setup lang="ts">
// 设置视图:左侧面板导航 + 右侧表单。
// 控件统一用 Naive UI(n-switch / n-select / n-input),外观由 themeOverrides 驱动。
import { ref } from 'vue'
import { NInput, NPopconfirm, NSelect, NSwitch, NTooltip } from 'naive-ui'
import { Info, Keyboard, Plug, ShieldCheck, SlidersHorizontal } from 'lucide-vue-next'
import { alt, mod, shift } from '../lib/platform'
import { useAppTheme, type ThemeMode } from '../theme'

type PanelKey = 'general' | 'connection' | 'permissions' | 'shortcuts' | 'about'

const { mode, setMode } = useAppTheme()

const panels: { key: PanelKey; label: string; icon: typeof Info }[] = [
  { key: 'general', label: '通用', icon: SlidersHorizontal },
  { key: 'connection', label: '连接', icon: Plug },
  { key: 'permissions', label: '权限', icon: ShieldCheck },
  { key: 'shortcuts', label: '快捷键', icon: Keyboard },
  { key: 'about', label: '关于', icon: Info },
]
const active = ref<PanelKey>('general')

/* 表单状态(接后端 config.get/set 前的本地态) */
const themeMode = ref<ThemeMode>(mode.value)
const compact = ref(false)
const autoConnect = ref(true)
const trayOnClose = ref(true)
const streamingOut = ref(true)
const serverUrl = ref('ws://127.0.0.1:<port>/api/ws')
const modelOptions = [
  { label: '自动选择(按任务路由)', value: 'auto' },
  { label: 'deepseek-v4-flash', value: 'deepseek-flash' },
  { label: 'claude-sonnet-4.6', value: 'claude' },
]
const model = ref('auto')
const maxTokens = ref('4096')
const tokenOptions = ['2048', '4096', '8192', '16384'].map((v) => ({ label: v, value: v }))
const approval = ref('ask')
const tools = ref([
  { key: 'web', mark: '网', name: 'Web 搜索', desc: '联网检索公开信息与来源', on: true },
  { key: 'code', mark: '>_', name: '代码执行', desc: '在沙箱中运行脚本与命令', on: true },
  { key: 'fs', mark: 'f', name: '文件读写', desc: '读写工作区内的文件', on: true },
  { key: 'shell', mark: '›', name: '终端命令', desc: '直接调用底层终端与进程', on: false },
  { key: 'image', mark: '§', name: '图像生成', desc: '生成示意与视觉素材', on: false },
])

const shortcuts = [
  { name: '开始新对话', keys: [mod('N')] },
  { name: '发送消息', keys: ['Enter'] },
  { name: '换行', keys: [shift('Enter')] },
  { name: '打开设置', keys: [mod(',')] },
  { name: '上下条消息', keys: [alt('↑'), alt('↓')] },
  { name: '显示我的消息', keys: [alt('M')] },
  { name: '切换工作区', keys: [mod('1'), mod('2')] },
]

function changeTheme(next: ThemeMode) {
  themeMode.value = next
  setMode(next)
}

/**
 * 重置界面:清掉前端所有本地偏好(统一以 hemisphere- 前缀存储),
 * 主题、对话列宽度、上次选中的会话等一并回到初始状态。
 * 只动界面偏好,不碰会话、档案与凭据(那些在后端)。
 */
function resetUi() {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i)
    if (k && k.startsWith('hemisphere-')) keys.push(k)
  }
  keys.forEach((k) => localStorage.removeItem(k))
  location.reload()
}
</script>

<template>
  <div class="settings">
    <header class="settings-title">
      <div>
        <h2>设置</h2>
        <p>管理连接、模型、权限、快捷键与界面行为。</p>
      </div>
    </header>

    <div class="settings-grid">
      <nav class="settings-nav" aria-label="设置导航">
        <button
          v-for="p in panels"
          :key="p.key"
          :class="{ active: active === p.key }"
          @click="active = p.key"
        >
          <component :is="p.icon" :size="15" />
          <span>{{ p.label }}</span>
        </button>
      </nav>

      <div class="settings-body">
        <!-- 通用 -->
        <section v-if="active === 'general'" class="settings-section">
          <h3>外观</h3>
          <p class="sec-hint">控制界面主题与信息密度。</p>

          <div class="setting-row">
            <div class="setting-copy"><strong>主题</strong><span>跟随系统的浅色与深色模式</span></div>
            <div class="seg">
              <button :class="{ active: themeMode === 'system' }" @click="changeTheme('system')">跟随系统</button>
              <button :class="{ active: themeMode === 'light' }" @click="changeTheme('light')">浅色</button>
              <button :class="{ active: themeMode === 'dark' }" @click="changeTheme('dark')">深色</button>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-copy"><strong>紧凑模式</strong><span>减少消息与列表之间的间距，适合大屏</span></div>
            <n-switch v-model:value="compact" />
          </div>

          <div class="setting-row">
            <div class="setting-copy">
              <strong>重置界面</strong>
              <span>把主题、对话列宽度、面板偏好等界面设置恢复为初始状态</span>
            </div>
            <n-popconfirm @positive-click="resetUi">
              <template #trigger>
                <button class="mini-btn">重置界面</button>
              </template>
              重置所有界面设置?不会影响会话、档案与凭据。
            </n-popconfirm>
          </div>
        </section>

        <!-- 连接 -->
        <section v-else-if="active === 'connection'" class="settings-section">
          <h3>连接</h3>
          <p class="sec-hint">Hemisphere 通过 hermes serve 连接后端。</p>

          <div class="setting-row">
            <div class="setting-copy"><strong>服务端地址</strong><span>本地或远程的 hermes serve 实例</span></div>
            <div class="setting-control">
              <n-input v-model:value="serverUrl" size="small" />
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-copy"><strong>启动时自动连接</strong><span>应用打开即连接默认服务端</span></div>
            <n-switch v-model:value="autoConnect" />
          </div>

          <div class="setting-row">
            <div class="setting-copy"><strong>关闭时最小化到托盘</strong><span>不退出后台代理进程</span></div>
            <n-switch v-model:value="trayOnClose" />
          </div>

          <h3 class="gap">模型</h3>
          <p class="sec-hint">决定新对话使用的模型路由与输出方式。</p>

          <div class="setting-row">
            <div class="setting-copy"><strong>默认模型</strong><span>新对话使用的模型路由</span></div>
            <div class="setting-control">
              <n-select v-model:value="model" :options="modelOptions" size="small" />
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-copy"><strong>流式输出</strong><span>逐步显示助手回复而不是一次性渲染</span></div>
            <n-switch v-model:value="streamingOut" />
          </div>

          <div class="setting-row">
            <div class="setting-copy"><strong>最大输出令牌</strong><span>单次回复的上限</span></div>
            <div class="setting-control">
              <n-select v-model:value="maxTokens" :options="tokenOptions" size="small" />
            </div>
          </div>
        </section>

        <!-- 权限 -->
        <section v-else-if="active === 'permissions'" class="settings-section">
          <h3>工具调用</h3>
          <p class="sec-hint">控制代理执行外部操作时是否需要你的确认。</p>

          <div class="setting-row">
            <div class="setting-copy"><strong>确认策略</strong><span>工具触发时的授权方式</span></div>
            <div class="seg">
              <button :class="{ active: approval === 'ask' }" @click="approval = 'ask'">每次询问</button>
              <button :class="{ active: approval === 'safe' }" @click="approval = 'safe'">仅高风险</button>
              <button :class="{ active: approval === 'none' }" @click="approval = 'none'">全部允许</button>
            </div>
          </div>

          <h3 class="gap">可用工具</h3>
          <p class="sec-hint">按工具维度控制代理的权限边界。</p>

          <div v-for="t in tools" :key="t.key" class="tool-toggle">
            <div class="setting-copy">
              <strong><span class="tool-mark">{{ t.mark }}</span>{{ t.name }}</strong>
              <span>{{ t.desc }}</span>
            </div>
            <n-switch v-model:value="t.on" />
          </div>
        </section>

        <!-- 快捷键 -->
        <section v-else-if="active === 'shortcuts'" class="settings-section">
          <h3>快捷键</h3>
          <div class="keygrid">
            <div v-for="s in shortcuts" :key="s.name" class="keyrow">
              <span class="k-name">{{ s.name }}</span>
              <span class="k-bind">
                <n-tooltip v-for="k in s.keys" :key="k" trigger="hover">
                  <template #trigger><span class="keycap">{{ k }}</span></template>
                  待支持自定义
                </n-tooltip>
              </span>
            </div>
          </div>
        </section>

        <!-- 关于 -->
        <section v-else class="settings-section">
          <div class="about-hero">
            <span class="about-logo">H</span>
            <div>
              <h2>Hemisphere</h2>
              <div class="about-version"><span>版本 0.1.0 · 开发版</span><span>通道 stable</span></div>
            </div>
          </div>
          <div class="about-row"><span>运行时</span><span class="mono">Tauri 2 · Vue 3 · Rust stable</span></div>
          <div class="about-row"><span>后端协议</span><span class="mono">tui_gateway JSON-RPC/WS</span></div>
          <p class="about-note">
            对话、任务与模型配置保存在本地。远程连接时，数据经由你自建的 hermes serve 传输，不经过第三方。
          </p>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 22px 26px 30px;
}

.settings-title h2 { margin: 0 0 4px; font-size: 18px; }
.settings-title p { margin: 0 0 22px; color: var(--muted); font-size: 12px; }

.settings-grid {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 26px;
  align-items: start;
}

.settings-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.settings-nav button {
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
.settings-nav button:hover { background: var(--fg-soft); color: var(--fg); }
.settings-nav button.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

.settings-section {
  max-width: 720px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.settings-section h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 650;
}
.settings-section h3.gap { margin-top: 22px; }
.sec-hint { margin: 4px 0 12px; color: var(--muted); font-size: 12px; }

.setting-row {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 11px 0;
  border-bottom: 1px solid var(--border);
}

.setting-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.setting-copy strong { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 7px; }
.setting-copy span { color: var(--muted); font-size: 11px; }

.setting-control { flex: 0 0 220px; }

.tool-mark {
  width: 18px;
  height: 18px;
  display: inline-grid;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 5px;
  font: 10px var(--font-mono);
  color: var(--muted);
}

.tool-toggle {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}

.seg {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--fg-soft);
}
.seg button {
  height: 26px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font-size: 11px;
}
.seg button.active {
  background: var(--surface);
  color: var(--fg);
  font-weight: 600;
}

.mini-btn {
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface);
  color: var(--fg);
  font-size: 12px;
}
.mini-btn:hover { border-color: var(--accent); color: var(--accent); }

.keygrid { display: flex; flex-direction: column; }
.keyrow {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}
.k-name { flex: 1; font-size: 13px; }
.k-bind { display: flex; gap: 6px; }
.keycap {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--muted);
  font: 11px var(--font-mono);
}

.about-hero {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 18px;
}
.about-hero h2 { margin: 0; font-size: 16px; }
.about-logo {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: 1px solid var(--fg);
  border-radius: 12px;
  font: 15px var(--font-mono);
}
.about-version { display: flex; gap: 10px; color: var(--muted); font-size: 11px; margin-top: 3px; }

.about-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.mono { color: var(--muted); font: 11px var(--font-mono); }

.about-note { margin: 16px 0 0; color: var(--muted); font-size: 11px; line-height: 1.6; }
</style>

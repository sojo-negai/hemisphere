<script setup lang="ts">
// 能力视图:消息平台 / 技能 / MCP / 定时任务 / 工具权限。
// 布局为「列表 + 右侧详情」两栏。
// 数据为本地示例;接后端后分别对应 messaging / skills / mcp / cron / tools 的 RPC。
import { computed, ref } from 'vue'
import { NSwitch } from 'naive-ui'
import { ArrowRight, Clock, ExternalLink, Pause, Play, Plus, RefreshCw, Trash2 } from 'lucide-vue-next'

/* ── 标签页 ───────────────────────────────────── */
type TabKey = 'platforms' | 'skills' | 'mcp' | 'cron' | 'tools'

const tabs: { key: TabKey; label: string }[] = [
  { key: 'platforms', label: '消息平台' },
  { key: 'skills', label: '技能' },
  { key: 'mcp', label: 'MCP' },
  { key: 'cron', label: '定时任务' },
  { key: 'tools', label: '工具权限' },
]
const active = ref<TabKey>('platforms')

/* ── 数据(示例) ───────────────────────────────── */
interface Item {
  id: string
  name: string
  desc: string
  on: boolean
  /** 行上展示的标签 */
  tags: string[]
  /** 右侧详情:键值对 */
  facts: [string, string][]
  /** 右侧详情:附注 */
  note?: string
}

const data: Record<TabKey, Item[]> = {
  platforms: [
    {
      id: 'tg', name: 'Telegram', desc: 'Bot 转发与群聊 @ 唤醒', on: true, tags: ['已连接', '@bot'],
      facts: [['连接状态', '已连接'], ['最近消息', '2 分钟前'], ['绑定账号', '@hemisphere_bot'], ['转发范围', '私聊 + 3 个群']],
      note: '消息在网关侧排队,断线后自动补发最近 50 条。',
    },
    {
      id: 'dc', name: 'Discord', desc: '频道消息与线程回复', on: true, tags: ['已连接', '2 频道'],
      facts: [['连接状态', '已连接'], ['最近消息', '18 分钟前'], ['绑定账号', 'Hemisphere#4417'], ['转发范围', '#general, #dev']],
    },
    {
      id: 'slack', name: 'Slack', desc: '工作区 App 与斜杠命令', on: false, tags: ['未配置'],
      facts: [['连接状态', '未配置'], ['需要', 'Bot Token + Signing Secret'], ['可用命令', '/hermes, /ask']],
      note: '配置后支持在频道内 @ 唤起,并把长回复折叠成 thread。',
    },
    {
      id: 'wechat', name: '微信', desc: '经本地网关转发', on: false, tags: ['未配置'],
      facts: [['连接状态', '未配置'], ['依赖', '本地网关进程'], ['限制', '仅文本与图片']],
    },
    { id: 'feishu', name: '飞书', desc: '机器人应用回调', on: false, tags: ['未配置'], facts: [['连接状态', '未配置'], ['需要', 'App ID + 回调地址']] },
  ],
  skills: [
    {
      id: 'plan', name: 'plan', desc: '把目标拆成可执行步骤并落成文件', on: true, tags: ['内置'],
      facts: [['来源', '内置'], ['触发', '/plan 或任务型提示'], ['最近使用', '今天 10:24'], ['文件数', '3']],
      note: '产出写入 .hermes/plans/,便于后续会话接着执行。',
    },
    {
      id: 'debug', name: 'systematic-debugging', desc: '四阶段根因排查流程', on: true, tags: ['内置'],
      facts: [['来源', '内置'], ['触发', '报错或行为异常时'], ['最近使用', '昨天']],
    },
    {
      id: 'docs', name: 'document-to-action-items', desc: '从文档抽取义务、截止时间与任务', on: true, tags: ['内置'],
      facts: [['来源', '内置'], ['触发', '/document-to-action-items'], ['最近使用', '上周']],
    },
    {
      id: 'comfy', name: 'comfyui', desc: '通过扩散工作流生成图像 / 视频 / 音频', on: false, tags: ['可选'],
      facts: [['来源', '可选技能库'], ['依赖', '本地 ComfyUI 服务'], ['状态', '未启用']],
    },
    {
      id: 'mine', name: 'my-workflow', desc: '本项目自定义的交付流程', on: true, tags: ['自建'],
      facts: [['来源', '自建'], ['路径', '~/.hermes/skills/my-workflow'], ['最近使用', '今天']],
    },
  ],
  mcp: [
    {
      id: 'fs', name: 'filesystem', desc: '工作区文件读写', on: true, tags: ['stdio', '26 工具'],
      facts: [['传输', 'stdio'], ['进程', 'node server-filesystem'], ['工具数', '26'], ['最近调用', '3 分钟前']],
      note: '提供 read/write/list/move 等文件级工具,已限制在项目目录内。',
    },
    {
      id: 'everything', name: 'server-everything', desc: '调试验证用的示例服务器', on: false, tags: ['stdio', '13 工具'],
      facts: [['传输', 'stdio'], ['工具数', '13'], ['用途', '调试 MCP 链路']],
    },
    { id: 'http', name: 'internal-api', desc: '内部 HTTP 接口桥接', on: false, tags: ['http'], facts: [['传输', 'http'], ['工具数', '0'], ['端点', 'https://internal.example/mcp']] },
  ],
  cron: [
    {
      id: 'digest', name: '每日早报', desc: '汇总昨日提交与待办,推送到 Telegram', on: true, tags: ['每天 09:00'],
      facts: [['频率', '每天 09:00'], ['下次运行', '明天 09:00'], ['上次结果', '成功 · 6.2s'], ['投递', 'Telegram · 私聊']],
      note: '运行在独立会话中,不污染当前对话上下文。',
    },
    {
      id: 'sweep', name: '依赖巡检', desc: '检查依赖安全告警并生成报告', on: true, tags: ['每周一 10:30'],
      facts: [['频率', '每周一 10:30'], ['下次运行', '周一 10:30'], ['上次结果', '成功 · 1m04s'], ['投递', '写入 artifacts']],
    },
    {
      id: 'cleanup', name: '会话清理', desc: '归档 30 天前的会话记录', on: false, tags: ['已暂停'],
      facts: [['频率', '每天 03:00'], ['下次运行', '—'], ['上次结果', '已暂停'], ['保留策略', '保留 30 天']],
    },
  ],
  tools: [
    {
      id: 'web', name: 'Web 搜索', desc: '联网检索公开信息与来源', on: true, tags: ['只读', '低风险'],
      facts: [['权限', '只读'], ['风险', '低'], ['最近调用', '今天 09:12'], ['数据去向', '公开检索接口']],
    },
    {
      id: 'code', name: '代码执行', desc: '在沙箱中运行脚本与命令', on: true, tags: ['可写', '中风险'],
      facts: [['权限', '读写'], ['风险', '中'], ['沙箱', '本地 Docker'], ['最近调用', '昨天']],
      note: '在容器内执行,默认不挂载主目录。',
    },
    {
      id: 'fs', name: '文件读写', desc: '读写工作区内的文件', on: true, tags: ['可写', '中风险'],
      facts: [['权限', '读写'], ['范围', '项目目录'], ['风险', '中'], ['最近调用', '今天 10:24']],
    },
    {
      id: 'shell', name: '终端命令', desc: '直接调用底层终端与进程', on: false, tags: ['可写', '高风险'],
      facts: [['权限', '读写 + 进程'], ['风险', '高'], ['状态', '已禁用'], ['建议', '仅项目内开启']],
      note: '开启后可执行任意命令,建议配合「每次询问」确认策略。',
    },
    {
      id: 'image', name: '图像生成', desc: '生成示意与视觉素材', on: false, tags: ['外部调用'],
      facts: [['权限', '只写产物'], ['风险', '低'], ['依赖', '图像生成插件']],
    },
  ],
}

const rows = computed(() => data[active.value])

/* ── 选中项(右侧详情) ─────────────────────────── */
const selectedByTab = ref<Record<TabKey, string>>({
  platforms: 'tg', skills: 'plan', mcp: 'fs', cron: 'digest', tools: 'web',
})
const selected = computed(
  () => rows.value.find((r) => r.id === selectedByTab.value[active.value]) ?? rows.value[0],
)
function select(id: string) {
  selectedByTab.value[active.value] = id
}

/* 切换标签时若选中项不属于当前标签,自动落到第一项 */
function switchTab(key: TabKey) {
  active.value = key
  if (!data[key].some((r) => r.id === selectedByTab.value[key])) {
    selectedByTab.value[key] = data[key][0].id
  }
}

const addLabel = computed(() => ({
  platforms: '接入平台', skills: '安装技能', mcp: '添加服务器', cron: '新建定时任务', tools: '',
}[active.value]))
</script>

<template>
  <div class="caps">
    <header class="caps-head">
      <div>
        <h2>能力</h2>
        <p>消息平台、技能、MCP、定时任务与工具权限集中在这里配置。</p>
      </div>
      <div class="head-actions">
        <button class="ghost-btn"><RefreshCw :size="14" /><span>刷新</span></button>
        <button v-if="addLabel" class="primary-btn"><Plus :size="14" /><span>{{ addLabel }}</span></button>
      </div>
    </header>

    <nav class="tabs" role="tablist">
      <button
        v-for="t in tabs"
        :key="t.key"
        :class="{ active: active === t.key }"
        role="tab"
        @click="switchTab(t.key)"
      >
        {{ t.label }}
        <span class="t-count">{{ data[t.key].length }}</span>
      </button>
    </nav>

    <div class="caps-grid">
      <!-- 左:列表 -->
      <section class="list">
        <button
          v-for="r in rows"
          :key="r.id"
          class="row"
          :class="{ selected: r.id === selected?.id }"
          @click="select(r.id)"
        >
          <div class="row-main">
            <div class="row-title">
              <strong class="mono">{{ r.name }}</strong>
              <span v-for="t in r.tags" :key="t" class="chip" :class="{ on: r.on }">{{ t }}</span>
            </div>
            <span class="row-desc">{{ r.desc }}</span>
          </div>
          <n-switch v-model:value="r.on" size="small" @click.stop />
        </button>
      </section>

      <!-- 右:选中项详情(填补右侧留白) -->
      <aside v-if="selected" class="aside">
        <div class="aside-head">
          <span class="aside-glyph">{{ selected.name.slice(0, 1).toUpperCase() }}</span>
          <div>
            <strong>{{ selected.name }}</strong>
            <span>{{ selected.desc }}</span>
          </div>
        </div>

        <dl class="facts">
          <div v-for="[k, v] in selected.facts" :key="k" class="fact">
            <dt>{{ k }}</dt>
            <dd>{{ v }}</dd>
          </div>
        </dl>

        <p v-if="selected.note" class="note">{{ selected.note }}</p>

        <div class="aside-actions">
          <template v-if="active === 'cron'">
            <button class="ghost-btn"><Play :size="13" />立即运行</button>
            <button class="ghost-btn"><Pause :size="13" />暂停</button>
          </template>
          <template v-else-if="active === 'mcp'">
            <button class="ghost-btn"><RefreshCw :size="13" />重连</button>
            <button class="ghost-btn"><ExternalLink :size="13" />查看日志</button>
          </template>
          <template v-else>
            <button class="ghost-btn"><ArrowRight :size="13" />配置</button>
          </template>
          <span class="spacer" />
          <button class="danger-btn" title="移除"><Trash2 :size="13" /></button>
        </div>

        <div v-if="active === 'cron'" class="next-run">
          <Clock :size="13" />
          <span>下次运行 {{ selected.facts.find(f => f[0] === '下次运行')?.[1] ?? '—' }}</span>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.caps {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 22px 26px 18px;
  overflow: hidden;
}

.caps-head {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.caps-head h2 { margin: 0 0 4px; font-size: 18px; }
.caps-head p { margin: 0; color: var(--muted); font-size: 12px; }
.head-actions { display: flex; gap: 8px; }

.tabs {
  flex: 0 0 auto;
  display: flex;
  gap: 4px;
  margin: 18px 0 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}
.tabs button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  font-size: 12.5px;
}
.tabs button:hover { background: var(--fg-soft); color: var(--fg); }
.tabs button.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
.t-count { color: var(--muted); font: 10px var(--font-mono); }
.tabs button.active .t-count { color: var(--accent); }

/* 两栏:列表 + 详情 */
.caps-grid {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 316px;
  gap: 20px;
}

.list {
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 4px;
}

.row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 11px 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--fg);
  text-align: left;
  transition: background 0.13s, border-color 0.13s;
}
.row:hover { background: var(--fg-soft); }
.row.selected {
  background: var(--surface);
  border-color: color-mix(in oklch, var(--accent) 40%, var(--border));
}

.row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.row-title { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.row-title strong { font-size: 13px; font-weight: 600; }
.row-desc { color: var(--muted); font-size: 11.5px; }

.mono { font-family: var(--font-mono); font-size: 12px; }

.chip {
  padding: 1px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--muted);
  font-size: 10px;
}
.chip.on {
  border-color: color-mix(in oklch, var(--ok) 40%, transparent);
  background: color-mix(in oklch, var(--ok) 12%, transparent);
  color: var(--ok);
}

/* 右侧详情 */
.aside {
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
}

.aside-head { display: flex; align-items: center; gap: 10px; }
.aside-head strong { display: block; font-size: 13.5px; font-weight: 650; }
.aside-head span { color: var(--muted); font-size: 11px; }

.aside-glyph {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background: var(--accent-soft);
  color: var(--accent);
  font: 12px var(--font-mono);
}

.facts { margin: 0; display: flex; flex-direction: column; gap: 9px; }
.fact { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.fact dt { color: var(--muted); font-size: 11px; flex: 0 0 auto; }
.fact dd { margin: 0; font-size: 12px; text-align: right; word-break: break-word; }

.note {
  margin: 0;
  padding: 9px 10px;
  border-radius: 8px;
  background: var(--fg-soft);
  color: var(--muted);
  font-size: 11px;
  line-height: 1.6;
}

.aside-actions { display: flex; align-items: center; gap: 6px; margin-top: auto; padding-top: 4px; }
.spacer { flex: 1; }

.ghost-btn {
  height: 28px;
  padding: 0 11px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--fg);
  font-size: 12px;
}
.ghost-btn:hover { border-color: var(--accent); color: var(--accent); }

.primary-btn {
  height: 28px;
  padding: 0 13px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  border-radius: 8px;
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
}

.danger-btn {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--muted);
}
.danger-btn:hover { border-color: var(--danger); color: var(--danger); }

.next-run {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--muted);
  font-size: 11px;
}
</style>

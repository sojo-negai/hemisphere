<script setup lang="ts">
// 工作区/档案管理弹窗:一站式的 profile 管理入口。
// 触发方式:侧栏顶部的工作区按钮。
// 每个档案可展开编辑:名称、配置模式、用途说明,以及身份文件 SOUL.md。
import { computed, nextTick, ref } from 'vue'
import { NInput, NModal, NPopconfirm, NTooltip, useMessage } from 'naive-ui'
import {
  Check, Copy, FolderOpen, Pencil, Plus, RotateCcw, Trash2,
} from 'lucide-vue-next'
import {
  activeProfile, activeProfileId, createProfile, duplicateProfile, profiles,
  removeProfile, setActiveProfile, updateProfile, type ProfileMode, type ProfileRow,
} from '../stores/profiles'

defineProps<{ show: boolean }>()
const emit = defineEmits<{
  'update:show': [value: boolean]
}>()

const message = useMessage()

const modeOptions: { key: ProfileMode; label: string; hint: string }[] = [
  { key: '默认配置', label: '默认配置', hint: '跟随默认档案,不做额外隔离' },
  { key: '隔离配置', label: '隔离配置', hint: '独立目录、会话与技能,互不影响' },
  { key: '共享配置', label: '共享配置', hint: '沿用默认档案的技能与配置' },
]

/* ── 展开编辑 ─────────────────────────────────── */
const expandedId = ref<string | null>(null)
// 编辑草稿:改动先落在草稿,「保存」才写回,便于撤销
const draft = ref<Pick<ProfileRow, 'name' | 'description' | 'mode' | 'soul'>>({
  name: '', description: '', mode: '默认配置', soul: '',
})

function toggleEdit(p: ProfileRow) {
  if (expandedId.value === p.id) {
    expandedId.value = null
    return
  }
  expandedId.value = p.id
  draft.value = { name: p.name, description: p.description, mode: p.mode, soul: p.soul }
}

function saveEdit(id: string) {
  updateProfile(id, { ...draft.value })
  message.success('已保存档案设置')
}

function resetSoul(p: ProfileRow) {
  draft.value.soul = ['# 身份', `你是「${p.name}」这个工作区的助手。`].join('\n')
}

const soulLines = computed(() => draft.value.soul.split('\n').length)

/* ── 切换 / 复制 / 删除 ───────────────────────── */
function pick(id: string) {
  setActiveProfile(id)
  emit('update:show', false)
  message.success(`已切换到「${profiles.find((p) => p.id === id)?.name}」`)
}

function onDuplicate(id: string) {
  const row = duplicateProfile(id)
  if (row) message.success(`已复制为「${row.name}」`)
}

function onRemove(id: string) {
  const name = profiles.find((p) => p.id === id)?.name
  if (expandedId.value === id) expandedId.value = null
  removeProfile(id)
  message.warning(`已删除档案「${name}」`)
}

/* ── 新建 ─────────────────────────────────────── */
const creating = ref(false)
const newName = ref('')
const newMode = ref<ProfileMode>('隔离配置')
const createInput = ref<InstanceType<typeof NInput> | null>(null)

async function startCreate() {
  creating.value = true
  newName.value = ''
  await nextTick()
  createInput.value?.focus()
}

function commitCreate() {
  const row = createProfile(newName.value, newMode.value)
  creating.value = false
  setActiveProfile(row.id)
  message.success(`已创建档案「${row.name}」`)
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    :style="{ width: '640px' }"
    :bordered="false"
    title="工作区与档案"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <p class="lead">
      每个档案是一套独立的配置、会话与技能,并拥有自己的身份文件
      <code>SOUL.md</code>(系统提示词第一段)。切换档案即切换整套环境。
    </p>

    <div class="list">
      <div
        v-for="p in profiles"
        :key="p.id"
        class="row"
        :class="{ active: p.id === activeProfileId, open: expandedId === p.id }"
      >
        <div class="row-head">
          <span class="glyph">{{ p.name.slice(0, 1) }}</span>

          <div class="info">
            <div class="title-line">
              <strong>{{ p.name }}</strong>
              <span class="mode-chip">{{ p.mode }}</span>
              <span v-if="p.id === activeProfileId" class="current-chip">
                <Check :size="10" />当前
              </span>
            </div>
            <div class="meta-line">
              <span class="mono">{{ p.path }}</span>
              <span class="sep">·</span>
              <span>{{ p.sessions }} 个会话</span>
              <span class="sep">·</span>
              <span>{{ p.model }}</span>
              <span class="sep">·</span>
              <span>上次使用 {{ p.lastUsed }}</span>
            </div>
            <p v-if="p.description" class="desc">{{ p.description }}</p>
          </div>

          <div class="actions">
            <n-tooltip trigger="hover">
              <template #trigger>
                <button class="act" :class="{ on: expandedId === p.id }" @click.stop="toggleEdit(p)">
                  <Pencil :size="14" />
                </button>
              </template>
              {{ expandedId === p.id ? '收起' : '编辑档案' }}
            </n-tooltip>
            <n-tooltip trigger="hover">
              <template #trigger>
                <button class="act" @click.stop="onDuplicate(p.id)"><Copy :size="14" /></button>
              </template>
              复制档案
            </n-tooltip>
            <n-popconfirm @positive-click="onRemove(p.id)">
              <template #trigger>
                <button class="act danger" @click.stop><Trash2 :size="14" /></button>
              </template>
              删除这个档案?该档案的会话与身份文件将不再可见。
            </n-popconfirm>
          </div>

          <button v-if="p.id !== activeProfileId" class="switch" @click.stop="pick(p.id)">切换</button>
          <button v-else class="switch ghost" disabled>使用中</button>
        </div>

        <!-- 展开:档案编辑区 -->
        <div v-if="expandedId === p.id" class="editor">
          <div class="field-grid">
            <label class="field">
              <span>档案名称</span>
              <n-input v-model:value="draft.name" size="small" />
            </label>
            <label class="field">
              <span>用途说明</span>
              <n-input
                v-model:value="draft.description"
                size="small"
                placeholder="这个档案准备用来做什么?"
              />
            </label>
          </div>

          <div class="field">
            <span class="field-label">配置模式</span>
            <div class="mode-grid">
              <button
                v-for="mo in modeOptions"
                :key="mo.key"
                type="button"
                class="mode-opt"
                :class="{ on: draft.mode === mo.key }"
                :aria-pressed="draft.mode === mo.key"
                @click="draft.mode = mo.key"
              >
                <span class="radio" />
                <strong>{{ mo.label }}</strong>
                <em>{{ mo.hint }}</em>
              </button>
            </div>
          </div>

          <div class="soul-head">
            <div>
              <strong>身份与人格</strong>
              <code>SOUL.md</code>
            </div>
            <div class="soul-acts">
              <span class="line-count">{{ soulLines }} 行</span>
              <button class="mini" @click="resetSoul(p)"><RotateCcw :size="12" />重置模板</button>
            </div>
          </div>
          <n-input
            v-model:value="draft.soul"
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 10 }"
            placeholder="# 身份&#10;你是……"
          />
          <p class="soul-note">
            写入 <code>{{ p.path }}/SOUL.md</code>,作为系统提示词的第一段注入;
            改动在<strong>新会话</strong>中生效(运行中的会话不会中途刷新提示词)。
          </p>

          <div class="editor-foot">
            <span class="spacer" />
            <button class="mini" @click="expandedId = null">取消</button>
            <button class="primary" @click="saveEdit(p.id)">保存</button>
          </div>
        </div>
      </div>

      <!-- 新建档案 -->
      <div v-if="creating" class="row creating">
        <div class="row-head">
          <span class="glyph">+</span>
          <div class="info">
            <n-input
              ref="createInput"
              v-model:value="newName"
              size="small"
              placeholder="档案名称,例如：客户 A"
              @keydown.enter="commitCreate"
            />
            <div class="mode-grid compact">
              <button
                v-for="mo in modeOptions"
                :key="mo.key"
                type="button"
                class="mode-opt"
                :class="{ on: newMode === mo.key }"
                :aria-pressed="newMode === mo.key"
                @click="newMode = mo.key"
              >
                <span class="radio" />
                <strong>{{ mo.label }}</strong>
                <em>{{ mo.hint }}</em>
              </button>
            </div>
          </div>
          <div class="actions always">
            <button class="switch" @click="commitCreate">创建</button>
            <button class="act wide" @click="creating = false">取消</button>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="footer">
        <button class="ghost" @click="startCreate"><Plus :size="14" />新建档案</button>
        <button class="ghost"><FolderOpen :size="14" />打开配置目录</button>
        <span class="spacer" />
        <span class="hint">当前:<strong>{{ activeProfile.name }}</strong></span>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.lead {
  margin: 0 0 14px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.65;
}
.lead code,
.soul-head code,
.soul-note code {
  padding: 1px 5px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--fg-soft);
  font: 10.5px var(--font-mono);
  color: var(--fg);
}

.list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 58vh;
  overflow-y: auto;
  padding-right: 2px;
}

.row {
  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--surface);
  transition: border-color 0.15s, background 0.15s;
}
.row:hover { border-color: color-mix(in oklch, var(--accent) 35%, var(--border)); }
.row.active {
  border-color: color-mix(in oklch, var(--accent) 42%, var(--border));
  background: var(--accent-soft);
}
.row.open { background: var(--surface); }

.row-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
}

.glyph {
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background: var(--fg);
  color: var(--surface);
  font: 12px var(--font-mono);
}

.info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }

.title-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
.title-line strong { font-size: 13px; font-weight: 600; white-space: nowrap; }

.mode-chip {
  flex: 0 0 auto;
  padding: 1px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--muted);
  font-size: 10px;
}

.current-chip {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--ok) 14%, transparent);
  color: var(--ok);
  font-size: 10px;
  font-weight: 600;
}

.meta-line {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 11px;
  min-width: 0;
  flex-wrap: wrap;
}
.meta-line .mono { font-family: var(--font-mono); font-size: 10.5px; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sep { opacity: 0.5; }

.desc {
  margin: 1px 0 0;
  color: var(--muted);
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions { flex: 0 0 auto; display: flex; align-items: center; gap: 2px; opacity: 0; transition: opacity 0.15s; }
.row:hover .actions { opacity: 1; }
.actions.always { opacity: 1; }

.act {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
}
.act:hover { background: var(--fg-soft); color: var(--fg); }
.act.on { background: var(--accent-soft); color: var(--accent); }
.act.danger:hover { color: var(--danger); }
.act.wide { width: auto; padding: 0 10px; }

.switch {
  flex: 0 0 auto;
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--fg);
  font-size: 12px;
}
.switch:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.switch.ghost { color: var(--muted); border-style: dashed; }

/* ── 配置模式:三张带说明的选项卡 ───────────────── */
.field-label { color: var(--muted); font-size: 11px; }

.mode-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 7px;
}
.mode-grid.compact { margin-top: 8px; gap: 6px; }

.mode-opt {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 10px 11px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.mode-opt:hover { border-color: color-mix(in oklch, var(--accent) 40%, var(--border)); }
.mode-opt.on {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.mode-opt strong { color: var(--fg); font-size: 12px; font-weight: 600; }
.mode-opt.on strong { color: var(--accent); }
.mode-opt em {
  color: var(--muted);
  font-size: 10.5px;
  font-style: normal;
  line-height: 1.5;
}

/* 单选圆点:选中时填实心 */
.radio {
  width: 11px;
  height: 11px;
  border: 1px solid color-mix(in oklch, var(--fg) 28%, transparent);
  border-radius: 50%;
}
.mode-opt.on .radio {
  border-color: var(--accent);
  background: var(--accent);
  box-shadow: inset 0 0 0 2px var(--surface);
}
.mode-grid.compact .mode-opt { padding: 8px 9px; gap: 3px; }
.mode-grid.compact .mode-opt strong { font-size: 11.5px; }
.mode-grid.compact .mode-opt em { font-size: 10px; }

/* ── 展开的编辑区 ─────────────────────────────── */
.editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 12px 13px;
  border-top: 1px dashed var(--border);
  margin-top: -1px;
}

.field-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 5px; }
.field > span { color: var(--muted); font-size: 11px; }

.soul-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 2px;
}
.soul-head > div { display: flex; align-items: center; gap: 7px; }
.soul-head strong { font-size: 12.5px; font-weight: 600; }

.soul-acts { display: flex; align-items: center; gap: 10px; }
.line-count { color: var(--muted); font: 10.5px var(--font-mono); }

.soul-note {
  margin: 0;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.6;
}
.soul-note strong { color: var(--fg); font-weight: 600; }

.editor-foot { display: flex; align-items: center; gap: 8px; }

.mini {
  height: 28px;
  padding: 0 11px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface);
  color: var(--fg);
  font-size: 12px;
}
.mini:hover { border-color: var(--accent); color: var(--accent); }

.primary {
  height: 28px;
  padding: 0 14px;
  border: 0;
  border-radius: 7px;
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
}

.row.creating { border-style: dashed; }

.footer { display: flex; align-items: center; gap: 10px; }
.ghost {
  height: 30px;
  padding: 0 13px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--fg);
  font-size: 12px;
}
.ghost:hover { border-color: var(--accent); color: var(--accent); }
.spacer { flex: 1; }
.hint { color: var(--muted); font-size: 11.5px; }
.hint strong { color: var(--fg); font-weight: 600; }
</style>

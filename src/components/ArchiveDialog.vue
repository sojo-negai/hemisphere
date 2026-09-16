<script setup lang="ts">
// 已归档对话:遮罩层列表。归档不删除数据,只从主列表收起,可恢复。
import { computed, ref } from 'vue'
import { NModal, NPopconfirm, useMessage } from 'naive-ui'
import { ArchiveRestore, RotateCcw, Search, Trash2 } from 'lucide-vue-next'
import { archived, type ArchivedRow } from '../stores/archive.mock'

defineProps<{ show: boolean }>()
const emit = defineEmits<{
  'update:show': [value: boolean]
}>()

const message = useMessage()
const rows = ref<ArchivedRow[]>([...archived])
const query = ref('')

const visible = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q ? rows.value.filter((r) => r.title.toLowerCase().includes(q)) : rows.value
})

function restore(row: ArchivedRow) {
  rows.value = rows.value.filter((r) => r.id !== row.id)
  message.success(`已恢复「${row.title}」到对话列表`)
}

function purge(row: ArchivedRow) {
  rows.value = rows.value.filter((r) => r.id !== row.id)
  message.warning(`已彻底删除「${row.title}」`)
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    :style="{ width: '620px' }"
    :bordered="false"
    title="已归档对话"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <p class="lead">
      归档只把对话从主列表收起,消息记录与文件都保留。恢复后回到侧栏原来的位置。
    </p>

    <div class="search-row">
      <Search :size="13" class="glyph" />
      <input v-model="query" class="input" placeholder="搜索已归档对话…" />
      <span class="count">{{ visible.length }} / {{ rows.length }}</span>
    </div>

    <div class="list">
      <div v-for="r in visible" :key="r.id" class="row">
        <span class="glyph-box"><ArchiveRestore :size="14" /></span>

        <div class="info">
          <div class="title-line">
            <strong>{{ r.title }}</strong>
            <span class="chip">{{ r.platform }}</span>
            <span class="chip">{{ r.project }}</span>
          </div>
          <div class="meta-line">
            <span>归档于 {{ r.archivedAt }}</span>
            <span class="sep">·</span>
            <span>最后活动 {{ r.lastActive }}</span>
            <span class="sep">·</span>
            <span>{{ r.messageCount }} 条消息</span>
          </div>
        </div>

        <div class="actions">
          <button class="mini" @click="restore(r)">
            <RotateCcw :size="12" />恢复
          </button>
          <n-popconfirm @positive-click="purge(r)">
            <template #trigger>
              <button class="mini danger" title="彻底删除"><Trash2 :size="12" /></button>
            </template>
            彻底删除这个对话?此操作不可撤销。
          </n-popconfirm>
        </div>
      </div>

      <p v-if="!visible.length" class="empty">
        {{ rows.length ? `没有匹配「${query}」的归档对话` : '归档是空的' }}
      </p>
    </div>

    <template #footer>
      <div class="footer">
        <span class="hint">共 {{ rows.length }} 个已归档对话</span>
        <span class="spacer" />
        <button class="ghost" @click="emit('update:show', false)">关闭</button>
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

.search-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 10px;
  margin-bottom: 12px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface);
}
.search-row:focus-within { border-color: color-mix(in oklch, var(--accent) 50%, var(--border)); }
.glyph { flex: 0 0 auto; color: var(--muted); }
.input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--fg);
  font-size: 12.5px;
}
.input::placeholder { color: var(--muted); }
.count { color: var(--muted); font: 10.5px var(--font-mono); }

.list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 46vh;
  overflow-y: auto;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
}
.row:hover { border-color: color-mix(in oklch, var(--accent) 35%, var(--border)); }

.glyph-box {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background: var(--fg-soft);
  color: var(--muted);
}

.info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.title-line { display: flex; align-items: center; gap: 7px; min-width: 0; }
.title-line strong {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip {
  flex: 0 0 auto;
  padding: 1px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--muted);
  font-size: 10px;
}

.meta-line { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 11px; }
.sep { opacity: 0.5; }

.actions { flex: 0 0 auto; display: flex; align-items: center; gap: 4px; }

.mini {
  height: 26px;
  padding: 0 9px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface);
  color: var(--fg);
  font-size: 11.5px;
}
.mini:hover { border-color: var(--accent); color: var(--accent); }
.mini.danger { padding: 0 7px; color: var(--muted); }
.mini.danger:hover { border-color: var(--danger); color: var(--danger); }

.empty {
  margin: 0;
  padding: 26px 12px;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
}

.footer { display: flex; align-items: center; gap: 10px; }
.hint { color: var(--muted); font-size: 11.5px; }
.spacer { flex: 1; }
.ghost {
  height: 30px;
  padding: 0 13px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--fg);
  font-size: 12px;
}
.ghost:hover { border-color: var(--accent); color: var(--accent); }
</style>

// 档案(profile)管理:一站式工作区/配置切换。
// 数据暂为本地示例,接入后端后对应 profiles.list / create / describe /
// get_asset / set_asset(SOUL.md 走 asset 读写)与 profiles.configure。
import { computed, reactive, ref } from 'vue'

export type ProfileMode = '默认配置' | '隔离配置' | '共享配置'

export interface ProfileRow {
  id: string
  name: string
  mode: ProfileMode
    description: string
  /** 档案数据目录(展示用;真机由后端下发的 HERMES_HOME 决定) */
  path: string
  sessions: number
  model: string
  lastUsed: string
  /** 身份文件内容($HERMES_HOME/SOUL.md),注入系统提示词第 1 段 */
  soul: string
}

/** 档案列表(示例) */
export const profiles = reactive<ProfileRow[]>([
  {
    id: 'default',
    name: '本地工作区',
    mode: '默认配置',
    description: '日常对话与默认配置',
    path: '~/.hermes',
    sessions: 128,
    model: '自动选择',
    lastUsed: '刚刚',
    soul: [
      '# 身份',
      '你是 Hermes,一个直接、务实的执行型助手。',
      '',
      '## 语气',
      '- 先给结论,再给理由,不做无谓铺垫。',
      '- 不确定就直说,不编造。',
    ].join('\n'),
  },
  {
    id: 'research',
    name: '研究项目',
    mode: '隔离配置',
    description: '论文与实验,独立会话与技能',
    path: '~/.hermes/profiles/research',
    sessions: 42,
    model: 'deepseek-v4-flash',
    lastUsed: '昨天',
    soul: [
      '# 身份',
      '你是研究助理,擅长文献梳理与实验设计。',
      '',
      '## 约定',
      '- 任何结论都要附来源与置信度。',
      '- 数字必须先核验再引用。',
    ].join('\n'),
  },
  {
    id: 'team',
    name: '团队空间',
    mode: '共享配置',
    description: '对外协作与发布相关事务',
    path: '~/.hermes/profiles/team',
    sessions: 17,
    model: 'claude-sonnet-4.6',
    lastUsed: '上周',
    soul: ['# 身份', '你负责对外协作,措辞需谨慎、克制。'].join('\n'),
  },
])

/** 当前前台档案 id */
export const activeProfileId = ref(profiles[0].id)

/** 当前档案 */
export const activeProfile = computed(
  () => profiles.find((p) => p.id === activeProfileId.value) ?? profiles[0],
)

/** 切换档案 */
export function setActiveProfile(id: string) {
  activeProfileId.value = id
  const row = profiles.find((p) => p.id === id)
  if (row) row.lastUsed = '刚刚'
}

/** 新建档案(接后端后走 profiles.create) */
export function createProfile(name: string, mode: ProfileMode = '隔离配置'): ProfileRow {
  const base = name.trim() || '新档案'
  let slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!slug) slug = `profile-${Date.now().toString(36)}`
  let unique = slug
  let n = 2
  while (profiles.some((p) => p.id === unique)) unique = `${slug}-${n++}`
  const row: ProfileRow = {
    id: unique,
    name: base,
    mode,
    description: '',
    path: `~/.hermes/profiles/${unique}`,
    sessions: 0,
    model: '自动选择',
    lastUsed: '刚刚',
    soul: ['# 身份', `你是「${base}」这个工作区的助手。`].join('\n'),
  }
  profiles.push(row)
  return row
}

/** 更新档案的可编辑字段 */
export function updateProfile(
  id: string,
  patch: Partial<Pick<ProfileRow, 'name' | 'description' | 'mode' | 'soul' | 'model'>>,
) {
  const row = profiles.find((p) => p.id === id)
  if (!row) return
  if (patch.name !== undefined && patch.name.trim()) row.name = patch.name.trim()
  if (patch.description !== undefined) row.description = patch.description
  if (patch.mode !== undefined) row.mode = patch.mode
  if (patch.soul !== undefined) row.soul = patch.soul
  if (patch.model !== undefined) row.model = patch.model
}

/** 复制档案(含配置与身份文件) */
export function duplicateProfile(id: string): ProfileRow | null {
  const src = profiles.find((p) => p.id === id)
  if (!src) return null
  const row = createProfile(`${src.name} 副本`, src.mode)
  updateProfile(row.id, { description: src.description, soul: src.soul, model: src.model })
  return row
}

/** 删除档案 */
export function removeProfile(id: string) {
  const idx = profiles.findIndex((p) => p.id === id)
  if (idx === -1) return
  const wasActive = profiles[idx].id === activeProfileId.value
  profiles.splice(idx, 1)
  // 删掉当前档案时回落到第一个,避免出现空工作区
  if (wasActive && profiles.length) activeProfileId.value = profiles[0].id
}

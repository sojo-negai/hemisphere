/*
 * Naive UI 主题桥接:把原型(oklch)的语义色换算成 hex 注入 themeOverrides,
 * 之后直接用 n-button / n-switch / n-select 即可贴合原型外观。
 *
 * 注意:Naive 内部用色彩工具解析色值,不认 oklch,这里必须是 hex/rgb。
 */
import { computed, ref, watchEffect } from 'vue'
import { darkTheme, type GlobalTheme, type GlobalThemeOverrides } from 'naive-ui'

export type ThemeMode = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'hemisphere-theme-mode'

/* ── 调色板:浅色取自原型,深色为同色相推导 ─────────────── */

interface Palette {
  bg: string
  surface: string
  fg: string
  muted: string
  border: string
  accent: string
  accentHover: string
  accentPressed: string
  ok: string
  warn: string
  danger: string
  /* 提示气泡:与界面反相,保证两种主题下都清晰 */
  tipBg: string
  tipFg: string
}

const light: Palette = {
  bg: '#F8FAFD',
  surface: '#FFFFFF',
  fg: '#0E1217',
  muted: '#6A6F76',
  border: '#E0E3E7',
  accent: '#1779E1',
  accentHover: '#3A8FE8',
  accentPressed: '#1063BD',
  ok: '#2B9F4A',
  warn: '#D39900',
  danger: '#D33A3C',
  tipBg: '#0E1217',
  tipFg: '#FFFFFF',
}

const dark: Palette = {
  bg: '#101419',
  surface: '#1B2025',
  fg: '#EBEFF2',
  muted: '#8E9398',
  border: '#2F3338',
  accent: '#4C99F8',
  accentHover: '#6BAAF9',
  accentPressed: '#3D82D6',
  ok: '#52B766',
  warn: '#E4AD3C',
  danger: '#EC5B57',
  tipBg: '#2F3338',
  tipFg: '#EBEFF2',
}

/* ── 把调色板映射为 Naive 的通用令牌 ─────────────────── */

function overridesFor(p: Palette): GlobalThemeOverrides {
  return {
    common: {
      // 主色系
      primaryColor: p.accent,
      primaryColorHover: p.accentHover,
      primaryColorPressed: p.accentPressed,
      primaryColorSuppl: p.accentHover,
      infoColor: p.accent,
      infoColorHover: p.accentHover,
      infoColorPressed: p.accentPressed,
      successColor: p.ok,
      warningColor: p.warn,
      errorColor: p.danger,

      // 文本层级
      textColorBase: p.fg,
      textColor1: p.fg,
      textColor2: p.fg,
      textColor3: p.muted,

      // 面与线
      bodyColor: p.bg,
      cardColor: p.surface,
      modalColor: p.surface,
      inputColor: p.surface,
      borderColor: p.border,
      dividerColor: p.border,

      // 形状与字体
      borderRadius: '10px',
      borderRadiusSmall: '7px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
      fontFamilyMono: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: '14px',
      fontSizeSmall: '13px',
      fontSizeTiny: '12px',
    },
    // 按钮贴近原型:主操作实心、次要操作低调
    Button: {
      borderRadiusMedium: '8px',
      borderRadiusSmall: '7px',
      fontWeight: '500',
    },
    Input: {
      borderRadius: '8px',
      color: p.surface,
      border: `1px solid ${p.border}`,
      borderHover: `1px solid ${p.accent}`,
      borderFocus: `1px solid ${p.accent}`,
      boxShadowFocus: `0 0 0 2px color-mix(in oklch, ${p.accent} 18%, transparent)`,
    },
    Switch: {
      railColorActive: p.accent,
    },
    Select: {
      peers: {
        InternalSelection: {
          borderRadius: '8px',
          border: `1px solid ${p.border}`,
          borderHover: `1px solid ${p.accent}`,
          borderFocus: `1px solid ${p.accent}`,
          borderActive: `1px solid ${p.accent}`,
        },
      },
    },
    Popover: {
      borderRadius: '10px',
    },
    Card: {
      borderRadius: '10px',
      color: p.surface,
    },
    Tag: {
      borderRadius: '999px',
    },
    // Tooltip 文字默认白色,而 popoverColor 被我们设成白色表面 → 必须显式配色,
    // 否则气泡内容不可见(表现为「有弹出但没有文字」)。
    Tooltip: {
      color: p.tipBg,
      textColor: p.tipFg,
      borderRadius: '7px',
      // Tooltip 的可见底色来自它内嵌的 Popover,必须一并指定;
      // 只设 color 不设 peers.Popover.color 会得到「白底白字」的空气泡。
      peers: {
        Popover: {
          color: p.tipBg,
          textColor: p.tipFg,
        },
      },
    },
  }
}

/* ── 对外状态:模式 / 是否深色 / Naive 主题对象 ───────────── */

const mode = ref<ThemeMode>(
  (localStorage.getItem(STORAGE_KEY) as ThemeMode | null) ?? 'system',
)

const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)')
const systemDark = ref(systemPrefersDark.matches)
systemPrefersDark.addEventListener('change', (e) => {
  systemDark.value = e.matches
})

const isDark = computed(() => (mode.value === 'system' ? systemDark.value : mode.value === 'dark'))

// 把解析后的主题写到 <html data-theme>,CSS 令牌随之切换
watchEffect(() => {
  document.documentElement.dataset.theme = isDark.value ? 'dark' : 'light'
})

export function useAppTheme() {
  return {
    mode,
    isDark,
    naiveTheme: computed<GlobalTheme | null>(() => (isDark.value ? darkTheme : null)),
    themeOverrides: computed(() => overridesFor(isDark.value ? dark : light)),
    setMode(next: ThemeMode) {
      mode.value = next
      localStorage.setItem(STORAGE_KEY, next)
    },
  }
}

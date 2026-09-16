/**
 * 平台相关的按键文案。
 *
 * 应用要同时跑 Windows / Linux / macOS,快捷键的修饰键写法不同,
 * 统一从这里取,避免把 macOS 的 ⌘ 硬编码到界面里。
 */

export const isMac =
  typeof navigator !== 'undefined' &&
  /mac/i.test(navigator.platform || navigator.userAgent)

const MOD = isMac ? '⌘' : 'Ctrl'
const ALT = isMac ? '⌥' : 'Alt'
const SHIFT = isMac ? '⇧' : 'Shift'

/** ⌘/Ctrl + 键,如 Ctrl+N */
export function mod(key: string): string {
  return isMac ? `${MOD}${key}` : `${MOD}+${key}`
}

/** ⌥/Alt + 键,如 Alt+↑ */
export function alt(key: string): string {
  return isMac ? `${ALT}${key}` : `${ALT}+${key}`
}

/** ⇧/Shift + 键,如 Shift+Enter */
export function shift(key: string): string {
  return isMac ? `${SHIFT} ${key}` : `${SHIFT}+${key}`
}

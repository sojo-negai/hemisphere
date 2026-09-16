import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './styles/tokens.css'
import './styles/base.css'

createApp(App).use(router).mount('#app')

/**
 * 屏蔽浏览器默认右键菜单。
 * 全局不再弹菜单,只有两类放行:
 *   1. 自己实现过右键行为的地方(像侧栏会话卡片,它先调了 preventDefault);
 *   2. 可编辑控件与标了 data-allow-context 的元素——保留系统的复制/粘贴菜单。
 */
const ALLOW_CONTEXT = 'input, textarea, [contenteditable="true"], [data-allow-context]'

document.addEventListener('contextmenu', (e) => {
  if (e.defaultPrevented) return
  const el = e.target as HTMLElement | null
  if (el?.closest(ALLOW_CONTEXT)) return
  e.preventDefault()
})

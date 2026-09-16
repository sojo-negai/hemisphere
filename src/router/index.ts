// 路由:顶层视图 —— 对话 / 能力 / 设置。
import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  // 桌面应用无服务端,用 hash 模式避免打包后刷新 404
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/conversation' },
    {
      path: '/conversation',
      name: 'conversation',
      component: () => import('../views/ConversationView.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/SettingsView.vue'),
    },
    {
      path: '/capabilities',
      name: 'capabilities',
      component: () => import('../views/CapabilitiesView.vue'),
    },
  ],
})

export default router

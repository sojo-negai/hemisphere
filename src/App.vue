<script setup lang="ts">
// 应用根组件:只负责主题与全局服务注入,布局交给 AppShell。
import { NConfigProvider, NDialogProvider, NGlobalStyle, NMessageProvider, dateZhCN, zhCN } from 'naive-ui'
import AppShell from './layouts/AppShell.vue'
import ConnectView from './views/ConnectView.vue'
import { connected } from './stores/connection'
import { useAppTheme } from './theme'

const { naiveTheme, themeOverrides } = useAppTheme()
</script>

<template>
  <!-- 语言包:Naive 的弹窗按钮/空态文案默认英文,这里统一为中文 -->
  <n-config-provider
    :theme="naiveTheme"
    :theme-overrides="themeOverrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
  >
    <n-global-style />
    <n-message-provider>
      <n-dialog-provider>
        <!-- 门禁:只有联通 hermes 内核后才进入主界面 -->
        <app-shell v-if="connected" />
        <connect-view v-else />
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

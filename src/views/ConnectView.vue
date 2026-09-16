<script setup lang="ts">
// 启动门禁页:只有联通 hermes 内核后才进入主界面。
// 启动即自动连接;失败时给出可操作的错误与重试入口,而不是停在白屏。
import { computed, onMounted, ref } from 'vue'
import { NTooltip } from 'naive-ui'
import { AlertCircle, Check, LoaderCircle, RefreshCw } from 'lucide-vue-next'
import { backendInfo, errorMessage, phase, startAndConnect } from '../stores/connection'

const attempted = ref(false)

/** 三个可观测的启动阶段,状态由真实连接进度推导 */
const steps = computed(() => {
  const started = phase.value === 'starting' || !!backendInfo.value
  return [
    {
      label: '启动 Hermes 内核',
      detail: 'hermes serve · 本机回环',
      state: backendInfo.value ? 'done' : started ? 'active' : 'idle',
    },
    {
      label: '建立 JSON-RPC 通道',
      detail: 'WebSocket · 一次性会话令牌',
      state: backendInfo.value ? 'done' : 'idle',
    },
    {
      label: '载入工作区',
      detail: '会话列表 · 模型路由',
      state: 'idle',
    },
  ] as { label: string; detail: string; state: 'idle' | 'active' | 'done' }[]
})

const failed = computed(() => phase.value === 'error' && !!errorMessage.value)

async function connect() {
  attempted.value = true
  try {
    await startAndConnect()
  } catch {
    // 失败信息由 errorMessage 呈现
  }
}

onMounted(() => {
  void connect()
})
</script>

<template>
  <div class="boot">
    <div class="boot-card">
      <div class="brand">
        <span class="brand-mark">H</span>
        <span class="brand-name">Hemisphere</span>
      </div>

      <p class="lead">
        {{ failed ? '无法连接 Hermes 内核' : '正在连接 Hermes 内核…' }}
      </p>

      <ul class="steps">
        <li v-for="s in steps" :key="s.label" :class="s.state">
          <span class="step-mark">
            <Check v-if="s.state === 'done'" :size="13" />
            <LoaderCircle v-else-if="s.state === 'active'" :size="13" class="spin" />
            <span v-else class="dot" />
          </span>
          <span class="step-copy">
            <strong>{{ s.label }}</strong>
            <small>{{ s.detail }}</small>
          </span>
        </li>
      </ul>

      <div v-if="failed" class="error-box">
        <AlertCircle :size="14" />
        <span>{{ errorMessage }}</span>
      </div>

      <div class="actions">
        <button class="primary" :disabled="phase === 'starting'" @click="connect">
          <LoaderCircle v-if="phase === 'starting'" :size="15" class="spin" />
          <RefreshCw v-else :size="15" />
          {{ attempted ? '重试连接' : '连接' }}
        </button>
        <n-tooltip trigger="hover">
          <template #trigger>
            <span class="hint">需要在本机安装 Hermes CLI</span>
          </template>
          应用会以无头模式启动 `hermes serve --port 0`,并通过回环令牌建立连接
        </n-tooltip>
      </div>
    </div>
  </div>
</template>

<style scoped>
.boot {
  height: 100vh;
  display: grid;
  place-items: center;
  background: var(--bg);
}

.boot-card {
  width: 380px;
  padding: 30px 28px 24px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
  box-shadow: 0 18px 50px color-mix(in oklch, var(--fg) 10%, transparent);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
}

.brand-mark {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 1px solid var(--fg);
  border-radius: 9px;
  font: 13px var(--font-mono);
}

.brand-name {
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.lead {
  margin: 0 0 16px;
  color: var(--muted);
  font-size: 12px;
}

.steps {
  list-style: none;
  margin: 0 0 18px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.steps li {
  display: flex;
  align-items: center;
  gap: 10px;
}

.step-mark {
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 50%;
  color: var(--muted);
}
.steps li.done .step-mark {
  border-color: var(--ok);
  background: color-mix(in oklch, var(--ok) 14%, transparent);
  color: var(--ok);
}
.steps li.active .step-mark {
  border-color: var(--accent);
  color: var(--accent);
}

.dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--border);
}

.step-copy { display: flex; flex-direction: column; gap: 1px; }
.step-copy strong { font-size: 12.5px; font-weight: 600; }
.step-copy small { color: var(--muted); font-size: 10.5px; }

.steps li.idle .step-copy strong { color: var(--muted); font-weight: 500; }

.error-box {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 16px;
  padding: 10px 12px;
  border-radius: 9px;
  background: color-mix(in oklch, var(--danger) 10%, transparent);
  color: var(--danger);
  font-size: 11.5px;
  line-height: 1.55;
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.primary {
  height: 32px;
  padding: 0 16px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 0;
  border-radius: 8px;
  background: var(--accent);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
}
.primary:disabled { opacity: 0.6; }

.hint {
  color: var(--muted);
  font-size: 11px;
  border-bottom: 1px dashed var(--border);
}

.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>

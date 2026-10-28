<template>
  <div class="setting-row" :class="{ 'is-block': block }">
    <div class="setting-head">
      <label class="setting-label" :for="id">
        {{ label }}
        <span v-if="hint" class="setting-hint">{{ hint }}</span>
      </label>
      <p v-if="desc" class="setting-desc">{{ desc }}</p>
    </div>
    <div class="setting-body">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 设置项外壳：左边标题 + 说明，右边控件。
 * `block` 用于标签输入、开关组这类需要整行宽度的控件。
 */
withDefaults(defineProps<{
  label: string
  desc?: string
  hint?: string
  id?: string
  block?: boolean
}>(), { desc: '', hint: '', id: undefined, block: false })
</script>

<style scoped>
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 10px 0;
  border-bottom: 1px solid var(--k-color-divider-light, #f0f2f5);
}

.setting-row:last-child {
  border-bottom: 0;
}

.setting-row.is-block {
  display: block;
}

.setting-head {
  min-width: 0;
}

.setting-label {
  display: block;
  color: var(--k-text-dark, #333);
  font-size: 14px;
  font-weight: 500;
  line-height: 1.5;
}

.setting-hint {
  margin-left: 6px;
  color: var(--k-text-light, #999);
  font-size: 12px;
  font-weight: 400;
}

.setting-desc {
  margin: 2px 0 0;
  color: var(--k-text-light, #999);
  font-size: 12px;
  line-height: 1.5;
}

.setting-body {
  flex: 0 0 auto;
}

.is-block .setting-body {
  margin-top: 8px;
}
</style>

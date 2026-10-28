<template>
  <div class="tag-input" :class="{ 'is-disabled': disabled }">
    <span v-for="(tag, index) in modelValue" :key="`${tag}-${index}`" class="tag">
      <span class="tag-text" :title="tag">{{ tag }}</span>
      <button
        v-if="!disabled"
        type="button"
        class="tag-remove"
        :aria-label="`移除 ${tag}`"
        @click="remove(index)"
      >×</button>
    </span>

    <input
      v-model="draft"
      class="tag-field"
      :placeholder="modelValue.length ? '继续添加…' : placeholder"
      :disabled="disabled"
      spellcheck="false"
      @keydown.enter.prevent="commit"
      @keydown.delete="backspace"
      @blur="commit"
    >
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string[]
  placeholder?: string
  disabled?: boolean
}>(), { placeholder: '输入后回车', disabled: false })

const emit = defineEmits<{
  (event: 'update:modelValue', value: string[]): void
}>()

const draft = ref('')

function split(text: string): string[] {
  return text.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean)
}

function commit() {
  const additions = split(draft.value).filter((item) => !props.modelValue.includes(item))
  draft.value = ''
  if (!additions.length) return
  emit('update:modelValue', [...props.modelValue, ...additions])
}

function remove(index: number) {
  const next = props.modelValue.slice()
  next.splice(index, 1)
  emit('update:modelValue', next)
}

/** 输入框空着时按退格删最后一项，跟常见标签输入手感一致 */
function backspace(event: KeyboardEvent) {
  if (draft.value || !props.modelValue.length) return
  event.preventDefault()
  remove(props.modelValue.length - 1)
}
</script>

<style scoped>
.tag-input {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 4px 8px;
  border: 1px solid var(--k-color-border, #dce0e5);
  border-radius: 8px;
  background: var(--k-card-bg, #fff);
  transition: border-color 0.2s;
}

.tag-input:focus-within {
  border-color: var(--k-color-primary, #527ca6);
}

.tag-input.is-disabled {
  opacity: 0.6;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 1px 4px 1px 8px;
  border-radius: 999px;
  background: var(--k-color-primary-fade, #e8eef6);
  color: var(--k-color-primary, #527ca6);
  font-size: 12px;
  line-height: 20px;
}

.tag-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-remove {
  border: 0;
  padding: 0 2px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.7;
}

.tag-remove:hover {
  opacity: 1;
}

.tag-field {
  flex: 1 1 90px;
  min-width: 90px;
  border: 0;
  padding: 3px 2px;
  background: transparent;
  color: var(--k-text-dark, #333);
  font: inherit;
  font-size: 13px;
  outline: none;
}

.tag-field::placeholder {
  color: var(--k-text-light, #999);
}
</style>

<script setup lang="ts">
    import type { ChatMessage } from '@/utils/agent';

    defineProps<{
        message: ChatMessage;
    }>();

    const { t } = useI18n();
</script>

<template>
    <div class="message" :class="`message--${message.role}`">
        <div v-if="message.role === 'assistant'" class="message__avatar">
            <q-icon name="sym_o_smart_toy" size="18px" />
        </div>
        <div class="message__body">
            <div class="message__author">
                {{ message.role === 'assistant' ? t('message.assistant') : t('message.you') }}
            </div>
            <div class="message__content">{{ message.content }}</div>
        </div>
    </div>
</template>

<style scoped>
    .message {
        display: flex;
        gap: 10px;
        align-items: flex-start;
    }

    .message--user {
        flex-direction: row-reverse;
    }

    .message__avatar {
        display: grid;
        place-items: center;
        flex: none;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background-color: var(--ai-accent-soft);
        color: var(--ai-accent);
    }

    .message__body {
        max-width: 88%;
        min-width: 0;
    }

    .message--user .message__body {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
    }

    .message__author {
        margin-bottom: 4px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        color: var(--ai-text-muted);
    }

    .message__content {
        padding: 10px 13px;
        border-radius: 14px;
        font-size: 13.5px;
        line-height: 1.5;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        background-color: var(--ai-surface);
        color: var(--ai-text);
    }

    .message--assistant .message__content {
        border-top-left-radius: 4px;
    }

    .message--user .message__content {
        border-top-right-radius: 4px;
        background-color: var(--ai-accent-solid);
        color: #fff;
    }
</style>

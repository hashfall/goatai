<script setup lang="ts">
    import { useHead } from '@unhead/vue';
    import { computed, nextTick, onMounted, ref, watch } from 'vue';
    import { browser } from 'wxt/browser';
    import { storage } from 'wxt/utils/storage';

    import MessageBubble from '@/components/MessageBubble.vue';
    import {
        type AgentConfig,
        type ChatMessage,
        createAgentTransport,
        createNotConfiguredTransport,
        loadAgentConfig,
    } from '@/utils/agent';

    const { t } = useI18n();

    useHead({
        title: t('title'),
    });

    const messagesStorage = storage.defineItem<ChatMessage[]>('local:messages', {
        fallback: [],
    });
    const draftStorage = storage.defineItem<string>('local:draft', {
        fallback: '',
    });

    const messages = ref<ChatMessage[]>([]);
    const draft = ref('');
    const streaming = ref(false);
    const agent = ref<AgentConfig | null>(null);
    const agentPath = ref<string | null>(null);
    const agentError = ref<string | null>(null);
    const connected = computed(() => agent.value !== null);
    const messagesEl = ref<HTMLElement>();
    const composer = ref<{ focus: () => void }>();

    let controller: AbortController | null = null;

    const suggestions = ['summarize', 'explain', 'find'] as const;

    async function refreshAgent() {
        const result = await loadAgentConfig();
        agent.value = result.config;
        agentPath.value = result.path;
        agentError.value = result.error ?? null;
    }

    onMounted(async () => {
        messages.value = await messagesStorage.getValue();
        draft.value = await draftStorage.getValue();
        await refreshAgent();
    });

    watch(
        messages,
        (value) => {
            messagesStorage.setValue(value);
        },
        { deep: true },
    );
    watch(draft, (value) => {
        draftStorage.setValue(value);
    });

    function isNearBottom() {
        const el = messagesEl.value;
        return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    }

    async function scrollToBottom(force = false) {
        await nextTick();
        const el = messagesEl.value;
        if (el && (force || isNearBottom())) {
            el.scrollTop = el.scrollHeight;
        }
    }

    function newChat() {
        controller?.abort();
        messages.value = [];
        draft.value = '';
        nextTick(() => composer.value?.focus());
    }

    function useSuggestion(key: (typeof suggestions)[number]) {
        draft.value = t(`suggestions.${key}`);
        nextTick(() => composer.value?.focus());
    }

    function stop() {
        controller?.abort();
    }

    async function send() {
        const content = draft.value.trim();
        if (!content || streaming.value) {
            return;
        }

        await refreshAgent();
        const system = await browser.firedragon.getAgentsMd().catch(() => null);
        const transport = agent.value
            ? createAgentTransport(agent.value, system ?? '')
            : createNotConfiguredTransport(t('notConfigured'));

        messages.value.push({
            id: crypto.randomUUID(),
            role: 'user',
            content,
            createdAt: Date.now(),
        });

        const replyId = crypto.randomUUID();
        const history = messages.value.slice();
        messages.value.push({
            id: replyId,
            role: 'assistant',
            content: '',
            createdAt: Date.now(),
        });
        draft.value = '';

        streaming.value = true;
        controller = new AbortController();
        scrollToBottom(true);

        const updateReply = (update: (message: ChatMessage) => void) => {
            const message = messages.value.find(({ id }) => id === replyId);
            if (message) {
                update(message);
            }
        };

        try {
            for await (const chunk of transport.send(history, { signal: controller.signal })) {
                updateReply((message) => {
                    message.content += chunk;
                });
                scrollToBottom();
            }
        } catch (error) {
            if (!controller.signal.aborted) {
                console.error('[Goatai] agent request failed', error);
                updateReply((message) => {
                    message.content = `${t('error')}\n\n${error instanceof Error ? error.message : String(error)}`;
                });
            }
        } finally {
            streaming.value = false;
            controller = null;
            const index = messages.value.findIndex(({ id }) => id === replyId);
            if (index !== -1 && messages.value[index].content.trim() === '') {
                messages.value.splice(index, 1);
            }
            scrollToBottom();
        }
    }

    async function close() {
        try {
            await browser.firedragon.setBoolPref('firedragon.ai.panel.open', false);
        } catch {
            window.close();
        }
    }
</script>

<template>
    <div class="panel">
        <header class="panel__header">
            <div class="panel__header-inner">
                <div class="panel__brand">
                    <div class="panel__logo">
                        <q-icon name="sym_o_smart_toy" size="20px" />
                    </div>
                    <div class="panel__titles">
                        <div class="panel__title">{{ t('title') }}</div>
                        <div class="panel__subtitle">{{ t('subtitle') }}</div>
                    </div>
                </div>

                <div class="panel__actions">
                    <q-btn
                        flat
                        round
                        dense
                        size="sm"
                        icon="sym_o_add_comment"
                        :title="t('newChat')"
                        :disable="messages.length === 0 && !streaming"
                        @click="newChat"
                    />
                    <q-btn flat round dense size="sm" icon="sym_o_close" :title="t('close')" @click="close" />
                </div>
            </div>
        </header>

        <div ref="messagesEl" class="panel__messages">
            <div v-if="messages.length === 0" class="empty">
                <div class="empty__icon">
                    <q-icon name="sym_o_smart_toy" size="30px" />
                </div>
                <h1 class="empty__title">{{ t('emptyTitle') }}</h1>
                <p class="empty__subtitle">{{ t('emptySubtitle') }}</p>
                <div class="empty__suggestions">
                    <button
                        v-for="suggestion in suggestions"
                        :key="suggestion"
                        type="button"
                        class="suggestion"
                        @click="useSuggestion(suggestion)"
                    >
                        {{ t(`suggestions.${suggestion}`) }}
                    </button>
                </div>
            </div>

            <template v-else>
                <message-bubble v-for="message in messages" :key="message.id" :message="message" />
            </template>
        </div>

        <div class="composer">
            <div class="composer__status">
                <span class="composer__dot" :class="{ 'composer__dot--online': connected }" />
                {{ connected ? t('status.online') : t('status.offline') }}
                <span class="composer__hint" :title="agentPath ?? agentError ?? 'agents.json'">
                    {{ agent?.model?.split('/').pop() ?? 'agents.json' }}
                </span>
            </div>
            <div class="composer__box">
                <q-input
                    ref="composer"
                    v-model="draft"
                    class="composer__input"
                    type="textarea"
                    autogrow
                    borderless
                    dense
                    :placeholder="t('composer.placeholder')"
                    :maxlength="8000"
                    :disable="streaming"
                    @keydown.enter.exact.prevent="send"
                />
                <q-btn
                    v-if="streaming"
                    round
                    unelevated
                    size="sm"
                    class="composer__action"
                    icon="sym_o_stop"
                    :title="t('composer.stop')"
                    @click="stop"
                />
                <q-btn
                    v-else
                    round
                    unelevated
                    size="sm"
                    class="composer__action"
                    icon="sym_o_arrow_upward"
                    :title="t('composer.send')"
                    :disable="!draft.trim()"
                    @click="send"
                />
            </div>
        </div>
    </div>
</template>

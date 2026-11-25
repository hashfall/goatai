<script setup lang="ts">
    import { onMounted, ref } from 'vue';

    const { t } = useI18n();

    const DEFAULT_ENDPOINT = 'https://goatai-agent.goatai-agent.workers.dev/chat';
    const DEFAULT_MODEL = '@cf/openai/gpt-oss-20b';

    const endpoint = ref(DEFAULT_ENDPOINT);
    const model = ref(DEFAULT_MODEL);
    const token = ref('');
    const showToken = ref(false);
    const configPath = ref<string | null>(null);
    const configMessage = ref('');
    const configState = ref<'idle' | 'saved' | 'error'>('idle');

    const agentsMd = ref('');
    const agentsMdPath = ref<string | null>(null);
    const agentsMdMessage = ref('');
    const agentsMdState = ref<'idle' | 'saved' | 'error'>('idle');
    const fileInput = ref<HTMLInputElement | null>(null);

    onMounted(async () => {
        try {
            const raw = await browser.firedragon.getAgentsConfig();
            if (raw) {
                const parsed = JSON.parse(raw);
                configPath.value = parsed.path ?? null;
                configMessage.value = parsed.error ?? '';
                const config = parsed.config;
                const name = config?.default ?? 'goatai';
                const agent = config?.agents?.[name] ?? config?.agents?.goatai;
                if (agent) {
                    endpoint.value = agent.endpoint ?? DEFAULT_ENDPOINT;
                    model.value = agent.model ?? DEFAULT_MODEL;
                    token.value = agent.token ?? '';
                }
            }
        } catch (error) {
            configState.value = 'error';
            configMessage.value = String(error);
        }

        try {
            const content = await browser.firedragon.getAgentsMd();
            if (content) {
                agentsMd.value = content;
            }
        } catch (error) {
            agentsMdState.value = 'error';
            agentsMdMessage.value = String(error);
        }
    });

    async function saveConfig() {
        configState.value = 'idle';
        configMessage.value = '';
        try {
            let config: any = { default: 'goatai', agents: {} };
            const raw = await browser.firedragon.getAgentsConfig();
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed.config) {
                    config = parsed.config;
                }
            }
            config.default ??= 'goatai';
            config.agents ??= {};
            config.agents.goatai = {
                provider: 'cloudflare',
                endpoint: endpoint.value.trim(),
                model: model.value.trim(),
                token: token.value.trim(),
            };
            const path = await browser.firedragon.saveAgentsConfig(JSON.stringify(config, null, 2));
            configPath.value = path;
            configState.value = 'saved';
            configMessage.value = t('pages.ai.config.saved', { path });
        } catch (error) {
            configState.value = 'error';
            configMessage.value = String(error);
        }
    }

    function pickAgentsMd() {
        fileInput.value?.click();
    }

    async function onAgentsMdFile(event: Event) {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (!file) {
            return;
        }
        if (file.size > 128 * 1024) {
            agentsMdState.value = 'error';
            agentsMdMessage.value = t('pages.ai.agentsMd.tooLarge');
            return;
        }
        agentsMd.value = await file.text();
        agentsMdState.value = 'idle';
        agentsMdMessage.value = t('pages.ai.agentsMd.loaded', { name: file.name });
    }

    async function saveAgentsMd() {
        agentsMdState.value = 'idle';
        agentsMdMessage.value = '';
        try {
            const path = await browser.firedragon.saveAgentsMd(agentsMd.value);
            agentsMdPath.value = path;
            agentsMdState.value = 'saved';
            agentsMdMessage.value = t('pages.ai.agentsMd.saved', { path });
        } catch (error) {
            agentsMdState.value = 'error';
            agentsMdMessage.value = String(error);
        }
    }
</script>

<template>
    <q-page padding>
        <div class="column q-gutter-lg">
            <div>
                <h1 class="text-h5 q-mt-none q-mb-sm">{{ t('pages.ai.title') }}</h1>
                <div class="text-subtitle1">{{ t('pages.ai.description') }}</div>
            </div>

            <q-card>
                <q-card-section>
                    <h2 class="text-h6 no-margin">
                        <q-icon name="sym_o_key" class="q-mb-xs q-mr-xs" />
                        {{ t('pages.ai.config.title') }}
                    </h2>
                    <div class="text-caption q-mt-sm">{{ t('pages.ai.config.description') }}</div>
                </q-card-section>
                <q-separator />
                <q-card-section class="q-gutter-md">
                    <q-input
                        v-model="endpoint"
                        outlined
                        dense
                        :label="t('pages.ai.config.endpoint')"
                        :hint="t('pages.ai.config.endpointHint')"
                    />
                    <q-input
                        v-model="model"
                        outlined
                        dense
                        :label="t('pages.ai.config.model')"
                        :hint="t('pages.ai.config.modelHint')"
                    />
                    <q-input
                        v-model="token"
                        outlined
                        dense
                        :type="showToken ? 'text' : 'password'"
                        :label="t('pages.ai.config.token')"
                        :hint="t('pages.ai.config.tokenHint')"
                    >
                        <template #append>
                            <q-btn
                                flat
                                round
                                dense
                                :icon="showToken ? 'sym_o_visibility_off' : 'sym_o_visibility'"
                                @click="showToken = !showToken"
                            />
                        </template>
                    </q-input>

                    <div v-if="configPath" class="text-caption">agents.json: <code>{{ configPath }}</code></div>

                    <div class="row items-center q-gutter-sm">
                        <q-btn color="primary" :label="t('pages.ai.config.save')" @click="saveConfig" />
                        <span v-if="configMessage" :class="configState === 'error' ? 'text-negative' : 'text-positive'">
                            {{ configMessage }}
                        </span>
                    </div>
                </q-card-section>
            </q-card>

            <q-expansion-item
                icon="sym_o_help"
                :label="t('pages.ai.tokenHelp.title')"
                :caption="t('pages.ai.tokenHelp.caption')"
            >
                <q-card>
                    <q-card-section class="text-body2">
                        <p>{{ t('pages.ai.tokenHelp.intro') }}</p>
                        <p>{{ t('pages.ai.tokenHelp.admin') }}</p>
                        <pre class="q-pa-sm bg-grey-2 text-black rounded-borders">
cd workers/goatai-agent
pnpm dlx wrangler secret put AGENT_TOKEN
pnpm dlx wrangler deploy</pre>
                        <p>{{ t('pages.ai.tokenHelp.security') }}</p>
                    </q-card-section>
                </q-card>
            </q-expansion-item>

            <q-card>
                <q-card-section>
                    <h2 class="text-h6 no-margin">
                        <q-icon name="sym_o_description" class="q-mb-xs q-mr-xs" />
                        {{ t('pages.ai.agentsMd.title') }}
                    </h2>
                    <div class="text-caption q-mt-sm">{{ t('pages.ai.agentsMd.description') }}</div>
                </q-card-section>
                <q-separator />
                <q-card-section class="q-gutter-md">
                    <div class="row items-center q-gutter-sm">
                        <q-btn
                            outline
                            icon="sym_o_upload_file"
                            :label="t('pages.ai.agentsMd.upload')"
                            @click="pickAgentsMd"
                        />
                        <input
                            ref="fileInput"
                            type="file"
                            accept=".md,.markdown,text/markdown,text/plain"
                            style="display: none"
                            @change="onAgentsMdFile"
                        />
                        <span v-if="agentsMdPath" class="text-caption">
                            {{ agentsMdPath }}
                        </span>
                    </div>

                    <q-input
                        v-model="agentsMd"
                        type="textarea"
                        outlined
                        autogrow
                        :label="t('pages.ai.agentsMd.editor')"
                        input-style="min-height: 260px"
                    />

                    <div class="row items-center q-gutter-sm">
                        <q-btn color="primary" :label="t('pages.ai.agentsMd.save')" @click="saveAgentsMd" />
                        <span
                            v-if="agentsMdMessage"
                            :class="agentsMdState === 'error' ? 'text-negative' : 'text-positive'"
                        >
                            {{ agentsMdMessage }}
                        </span>
                    </div>
                </q-card-section>
            </q-card>
        </div>
    </q-page>
</template>

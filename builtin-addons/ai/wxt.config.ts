import { URL, fileURLToPath } from 'node:url';

import defineConfig from '@firedragon/build/wxt-config';
import vueI18n from '@intlify/unplugin-vue-i18n/vite';
import { quasar, transformAssetUrls } from '@quasar/vite-plugin';
import devtools from 'vite-plugin-vue-devtools';

import { getEdition } from '../../config';

export default defineConfig({
    modules: ['@wxt-dev/module-vue'],
    firedragon: {
        id: 'firedragon-ai',
    },
    imports: {
        presets: ['@vueuse/core', 'quasar', 'vue-i18n'],
    },
    vue: {
        vite: {
            template: {
                transformAssetUrls,
            },
        },
    },
    manifest: {
        name: 'Goatai',
        permissions: ['storage', 'https://*.workers.dev/*', 'http://localhost/*', 'http://127.0.0.1/*'],
    },
    vite: () => ({
        plugins: [
            vueI18n({
                include: [fileURLToPath(new URL('./assets/locales/*', import.meta.url))],
            }),
            quasar({
                sassVariables: getEdition()?.quasar,
            }),
            devtools({
                appendTo: '/entrypoints/panel/main.ts',
            }),
        ],
    }),
});

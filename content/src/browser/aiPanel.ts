import { effect } from '@vue/reactivity';

import { useBoolPref, useIntPref } from '@/composables/usePref.ts';
import { h } from '@/utils/render.ts';

const PREF_OPEN = 'firedragon.ai.panel.open';
const PREF_WIDTH = 'firedragon.ai.panel.width';

const MIN_WIDTH = 300;
const DEFAULT_WIDTH = 380;

const lazy = {} as {
    BuiltinAddons: typeof import('resource://firedragon/modules/BuiltinAddons.sys.mjs').BuiltinAddons;
};
ChromeUtils.defineESModuleGetters(lazy, {
    BuiltinAddons: 'resource://firedragon/modules/BuiltinAddons.sys.mjs',
});

document!.addEventListener(
    'DOMContentLoaded',
    () => {
        const container = document!.getElementById('browser');
        if (
            !container ||
            document!.getElementById('firedragon-ai-panel-box') ||
            document!.documentElement.getAttribute('chromehidden')?.includes('toolbar')
        ) {
            return;
        }

        const splitter = h('xul:splitter', {
            id: 'firedragon-ai-panel-splitter',
            class: 'chromeclass-extrachrome sidebar-splitter',
            resizebefore: 'none',
            resizeafter: 'sibling',
            role: 'separator',
        });
        const box = h('xul:vbox', {
            id: 'firedragon-ai-panel-box',
            class: 'chromeclass-extrachrome',
        });
        const stack = h('xul:stack', {
            class: 'firedragon-ai-panel-stack',
            flex: '1',
        });
        const browser = h('xul:browser', {
            id: 'firedragon-ai-panel-browser',
            type: 'content',
            remote: 'true',
            flex: '1',
            disablehistory: 'true',
            disableglobalhistory: 'true',
            disablefullscreen: 'true',
            messagemanagergroup: 'browsers',
            maychangeremoteness: 'true',
            autoscroll: 'false',
            tooltip: 'aHTMLTooltip',
        });

        const url = lazy.BuiltinAddons.ai?.getURL('panel.html');
        if (url) {
            browser.setAttribute('src', url);
        }

        stack.append(browser);
        box.append(stack);

        const anchor = document!.getElementById('ai-window-splitter');
        if (anchor) {
            container.insertBefore(splitter, anchor);
            container.insertBefore(box, anchor);
        } else {
            container.append(splitter, box);
        }

        const open = useBoolPref(PREF_OPEN, true);
        const width = useIntPref(PREF_WIDTH, DEFAULT_WIDTH);

        effect(() => {
            for (const el of [splitter, box]) {
                if (open.value) {
                    el.removeAttribute('collapsed');
                } else {
                    el.setAttribute('collapsed', 'true');
                }
            }
        });

        effect(() => {
            const max = Math.round(window.innerWidth * 0.75);
            const value = Math.min(Math.max(width.value, MIN_WIDTH), max);
            (box as HTMLElement).style.setProperty('width', `${value}px`);
        });

        splitter.addEventListener('command', () => {
            const value = Math.round(box.getBoundingClientRect().width);
            if (value >= MIN_WIDTH && value !== width.value) {
                width.value = value;
            }
        });

        function toggle() {
            open.value = !open.value;
        }

        const key = h('xul:key', {
            id: 'firedragon-ai-panel-key',
            key: 'A',
            modifiers: 'accel,alt',
            command: 'firedragon-ai-panel-toggle',
        });
        const command = h('xul:command', { id: 'firedragon-ai-panel-toggle' });
        command.addEventListener('command', toggle);
        document!.getElementById('mainCommandset')?.append(command);
        document!.getElementById('mainKeyset')?.append(key);

        const viewMenu = document!.getElementById('menu_viewPopup');
        if (viewMenu) {
            const item = h('xul:menuitem', {
                id: 'firedragon-ai-panel-menu',
                type: 'checkbox',
                label: 'Goatai',
                key: 'firedragon-ai-panel-key',
            });
            item.addEventListener('command', toggle);
            viewMenu.append(item);
            effect(() => {
                item.setAttribute('checked', open.value ? 'true' : 'false');
            });
        }

        const appMenu = document!.getElementById('PanelUI-button');
        if (appMenu) {
            const button = h('xul:toolbarbutton', {
                id: 'firedragon-ai-button',
                class: 'toolbarbutton-1 chromeclass-toolbar-additional',
                tooltiptext: 'Goatai',
                removable: 'false',
                'aria-pressed': 'false',
            });
            button.addEventListener('command', toggle);
            appMenu.parentNode!.insertBefore(button, appMenu);
            effect(() => {
                button.setAttribute('checked', open.value ? 'true' : 'false');
                button.setAttribute('aria-pressed', open.value ? 'true' : 'false');
            });
        }

        (window as any).gFiredragonAIPanel = {
            toggle,
            show() {
                open.value = true;
            },
            hide() {
                open.value = false;
            },
        };
    },
    { once: true },
);

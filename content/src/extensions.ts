/// <reference types="@firedragon/shared/types/extensions" />

const lazy: any = {};

ChromeUtils.defineESModuleGetters(lazy, {
    File: 'resource://firedragon/modules/utils/File.sys.mjs',
    PrivateBrowsingUtils: 'resource://gre/modules/PrivateBrowsingUtils.sys.mjs',
    SearchService: 'moz-src:///toolkit/components/search/SearchService.sys.mjs',
    SearchSuggestionController: 'moz-src:///toolkit/components/search/SearchSuggestionController.sys.mjs',
    ShellService: 'moz-src:///browser/components/shell/ShellService.sys.mjs',
});

globalThis.firedragon = class extends ExtensionAPI {
    getAPI(context) {
        return {
            firedragon: {
                getLogo(): Promise<string> {
                    return ExtensionUtils.makeDataURI('chrome://branding/content/about-logo.png');
                },
                restart() {
                    Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit! | Ci.nsIAppStartup.eRestart!);
                },
                open(url: string) {
                    ExtensionParent.apiManager.global.tabTracker.activeTab.linkedBrowser.loadURI(
                        Services.io.newURI(url),
                        {
                            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
                        },
                    );
                },
                async setDefault() {
                    await lazy.ShellService.setDefaultBrowser();
                },
                getNewTabURL(): string {
                    return AboutNewTab.newTabURL;
                },

                onPrefChanged: new ExtensionCommon.EventManager({
                    context,
                    name: 'prefs.onPrefChanged',
                    register(fire: any) {
                        const observer = (_subject: any, _topic: string, data: string) => {
                            fire.async(data);
                        };
                        Services.prefs.addObserver('', observer);
                        return () => {
                            Services.prefs.removeObserver('', observer);
                        };
                    },
                }).api(),

                getBoolPref(aPrefName: string, aDefaultValue?: boolean): boolean {
                    return Services.prefs.getBoolPref(aPrefName, aDefaultValue);
                },
                setBoolPref(aPrefName: string, aValue: boolean): void {
                    Services.prefs.setBoolPref(aPrefName, aValue);
                },
                getIntPref(aPrefName: string, aDefaultValue?: number): number {
                    return Services.prefs.getIntPref(aPrefName, aDefaultValue);
                },
                setIntPref(aPrefName: string, aValue: number): void {
                    Services.prefs.setIntPref(aPrefName, aValue);
                },
                getStringPref(aPrefName: string, aDefaultValue?: string): string {
                    return Services.prefs.getStringPref(aPrefName, aDefaultValue);
                },
                setStringPref(aPrefName: string, aValue: string): void {
                    Services.prefs.setStringPref(aPrefName, aValue);
                },

                prefIsLocked(aPrefName: string): boolean {
                    return Services.prefs.prefIsLocked(aPrefName);
                },

                prefHasUserValue(aPrefName: string): boolean {
                    return Services.prefs.prefHasUserValue(aPrefName);
                },
                clearUserPref(aPrefName: string): void {
                    Services.prefs.clearUserPref(aPrefName);
                },

                getChildList(aStartingAt: string): string[] {
                    return Services.prefs.getChildList(aStartingAt);
                },

                async getAgentsConfig(): Promise<string> {
                    const candidates = [
                        lazy.File.fromDirsvc('UAppData').append('config', 'agents.json'),
                        lazy.File.fromDirsvc('UAppData').append('agents.json'),
                        lazy.File.fromDirsvc('ProfD').append('agents.json'),
                        lazy.File.fromDirsvc('GreD').append('config', 'agents.json'),
                    ];
                    for (const file of candidates) {
                        if (!file.exists()) {
                            continue;
                        }
                        try {
                            const source = await IOUtils.readUTF8(file.path);
                            return JSON.stringify({
                                path: file.path,
                                config: JSON.parse(source),
                            });
                        } catch (e) {
                            return JSON.stringify({
                                path: file.path,
                                config: null,
                                error: String(e),
                            });
                        }
                    }
                    return JSON.stringify({
                        path: null,
                        config: null,
                        error: 'agents.json não encontrado',
                        searched: candidates.map((file: any) => file.path),
                    });
                },

                async saveAgentsConfig(source: string): Promise<string> {
                    let config: any;
                    try {
                        config = JSON.parse(source);
                    } catch (e) {
                        throw new Error(`agents.json inválido: ${e}`);
                    }
                    if (!config || typeof config !== 'object' || typeof config.agents !== 'object') {
                        throw new Error('agents.json inválido: campo "agents" ausente');
                    }
                    const dir = lazy.File.fromDirsvc('UAppData').append('config');
                    await IOUtils.makeDirectory(dir.path, {
                        ignoreExisting: true,
                        createAncestors: true,
                    });
                    const file = dir.clone().append('agents.json');
                    await IOUtils.writeUTF8(file.path, JSON.stringify(config, null, 2) + '\n');
                    await IOUtils.setPermissions(file.path, 0o600, false);
                    return file.path;
                },

                async getAgentsMd(): Promise<string | null> {
                    const candidates = [
                        lazy.File.fromDirsvc('UAppData').append('config', 'AGENTS.md'),
                        lazy.File.fromDirsvc('UAppData').append('AGENTS.md'),
                        lazy.File.fromDirsvc('ProfD').append('AGENTS.md'),
                    ];
                    for (const file of candidates) {
                        if (!file.exists()) {
                            continue;
                        }
                        return await IOUtils.readUTF8(file.path);
                    }
                    return null;
                },

                async saveAgentsMd(content: string): Promise<string> {
                    if (typeof content !== 'string') {
                        throw new Error('AGENTS.md inválido');
                    }
                    if (content.length > 128 * 1024) {
                        throw new Error('AGENTS.md muito grande (máximo 128 KB)');
                    }
                    const dir = lazy.File.fromDirsvc('UAppData').append('config');
                    await IOUtils.makeDirectory(dir.path, {
                        ignoreExisting: true,
                        createAncestors: true,
                    });
                    const file = dir.clone().append('AGENTS.md');
                    await IOUtils.writeUTF8(file.path, content);
                    await IOUtils.setPermissions(file.path, 0o600, false);
                    return file.path;
                },

                async getSearchSuggestions(searchString: string): Promise<string[]> {
                    const browser = ExtensionParent.apiManager.global.tabTracker.activeTab.linkedBrowser;
                    const privateMode = lazy.PrivateBrowsingUtils.isBrowserPrivate(browser);
                    const userContextId = browser!.ownerGlobal!.gBrowser.selectedBrowser.getAttribute('userContextId');
                    const controller = new lazy.SearchSuggestionController();
                    const engine = privateMode
                        ? lazy.SearchService.defaultPrivateEngine
                        : lazy.SearchService.defaultEngine;
                    const searchSuggestions = await controller.fetch({
                        searchString,
                        inPrivateBrowsing: privateMode,
                        engine,
                        userContextId: userContextId,
                    });
                    return [...searchSuggestions.local, ...searchSuggestions.remote].map(
                        (searchSuggestion) => searchSuggestion.value,
                    );
                },
            },
        };
    }
};

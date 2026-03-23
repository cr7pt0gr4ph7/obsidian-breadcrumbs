import { Notice } from "obsidian";
import type BreadcrumbsPlugin from "src/main";
import { new_setting } from "src/utils/settings";

export const _add_settings_field_fallbacks = (
    plugin: BreadcrumbsPlugin,
    containerEl: HTMLElement,
) => {
    new_setting(containerEl, {
        name: "Enabled",
        desc: "Use field fallback rules to generate additional links based on existing file metadata",
        toggle: {
            value: plugin.settings.explicit_edge_sources.field_fallbacks.enabled,
            cb: async (value) => {
                plugin.settings.explicit_edge_sources.field_fallbacks.enabled = value;
                await Promise.all([
                    plugin.rebuildGraph(),
                    plugin.saveSettings(),
                ]);
            },
        },
    });
};

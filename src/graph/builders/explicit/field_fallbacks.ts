import { dataview_plugin } from "src/external/dataview/index";
import type { IDataview } from "src/external/dataview/interfaces";
import type {
    EdgeBuilderResults,
    ExplicitEdgeBuilder,
} from "src/interfaces/graph";
import type { FieldFallbackRule } from "src/interfaces/settings";
import { log } from "src/logger";
import type BreadcrumbsPlugin from "src/main";
import { fail, succ } from "src/utils/result";
import { add_typed_edges_for_field } from "./typed_link";

function get_field_fallbacks_info(
    _plugin: BreadcrumbsPlugin,
    rule: FieldFallbackRule,
) {
    if (!rule) {
        return fail(undefined);
    }

    return succ({
        fields: rule.fields,
        query: rule.condition?.dataview_query,
    });
}

export const _add_explicit_edges_field_fallbacks: ExplicitEdgeBuilder = (
    plugin,
    _all_files,
) => {
    const results: EdgeBuilderResults = { nodes: [], edges: [], errors: [] };

    const fallback_settings = plugin.settings.explicit_edge_sources.field_fallbacks;
    if (!fallback_settings.enabled) {
        return results;
    }

    fallback_settings.rules.forEach((rule, index) => {
        const field_fallbacks_info = get_field_fallbacks_info(
            plugin,
            rule,
        );
        if (!field_fallbacks_info.ok) {
            if (field_fallbacks_info.error)
                results.errors.push(field_fallbacks_info.error);
            return;
        }
        const { fields, query } = field_fallbacks_info.data;

        let pages: IDataview.Page[] = [];
        try {
            /* eslint-disable */
            pages = dataview_plugin.get_api()!.pages(query ?? undefined)
                .values as IDataview.Page[];
            /* eslint-enable */
        } catch (error) {
            log.warn(
                "field-fallbacks > DV API error:",
                error instanceof Error ? error.message : error,
            );

            return results.errors.push({
                code: "invalid_setting_value",
                path: `explicit_edge_sources.field_fallbacks.rules[${index}]`,
                message: `dataview_query for field fallback rule '${rule.name}' is not a valid dataview query: '${query}'`,
            });
        }

        pages.forEach((page) => {
            // NOTE: I _believe_ we don't need to even safe_add_node, since dv will only return resolved notes
                fields.forEach(({ target_field, source_fields }) => {
                    if (page[target_field] !== undefined) {
                        return;
                    }
                    source_fields.some((source_field) => {
                        if (page[source_field] === undefined) {
                            return false;
                        }
                        add_typed_edges_for_field(
                            plugin,
                            results,
                            page.file.path,
                            target_field,
                            page[source_field],
                            "field_fallback",
                        );
                        return true;
                });
            });
        });
    });

    return results;
};

import { dataview_plugin } from "src/external/dataview/index";
import type { IDataview } from "src/external/dataview/interfaces";
import type {
    EdgeBuilderResults,
    ExplicitEdgeBuilder,
} from "src/interfaces/graph";
import type { FieldFallbackRule } from "src/interfaces/settings";
import { log } from "src/logger";
import type BreadcrumbsPlugin from "src/main";
import { ensure_is_array } from "src/utils/arrays";
import { resolve_relative_target_path } from "src/utils/obsidian";
import { fail, succ } from "src/utils/result";
import { GCEdgeData, GCNodeData } from "wasm/pkg/breadcrumbs_graph_wasm";

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
            pages = (dataview_plugin.get_api(plugin.app)!.pages(query ?? undefined) as any)
                .values as IDataview.Page[];
            /* eslint-enable */
        } catch (error) {
            log.debug(
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

const MARKDOWN_LINK_REGEX = /\[(.+?)\]\((.+?)\)/;

export function add_typed_edges_for_field(
	plugin: BreadcrumbsPlugin,
	results: EdgeBuilderResults,
	source_path: string,
	field: string,
	links: string | IDataview.Link | IDataview.Link[] | null,
	edge_source: string,
) {
	ensure_is_array(links)
		.flat()
		.forEach((target_link) => {
			let unsafe_target_path: string | undefined;

			// Quickly return for null or ''
			if (!target_link) return;
			else if (typeof target_link === "string") {
				// Try parse as a markdown link [](), grabbing the path out of the 2nd match
				unsafe_target_path =
					MARKDOWN_LINK_REGEX.exec(target_link)?.[2];
			} else if (typeof target_link === "object" &&
				target_link?.path) {
				unsafe_target_path = target_link.path;
			} else if (
				// @ts-expect-error: instanceof didn't work here?
				target_link?.isLuxonDateTime) {
				// eslint-disable @typescript-eslint/no-base-to-string
				results.errors.push({
					path: source_path,
					code: "invalid_field_value",
					message: `Invalid value for field '${field}': '${target_link}'. Dataview DateTime values are not supported, since they don't preserve the original date string.`,
				});
			} else {
				// It's a BC field, with a definitely invalid value, cause it's not a link
				results.errors.push({
					path: source_path,
					code: "invalid_field_value",
					message: `Invalid value for field '${field}': '${target_link}'. Expected wikilink or markdown link.`,
				});
			}

			if (!unsafe_target_path) return;

			const target_path_info = resolve_relative_target_path(
				plugin.app,
				unsafe_target_path,
				source_path
			);

            const target_path = target_path_info?.[0];
            const target_file = target_path_info?.[1];

            if (!target_path) {
                return;
            }

			if (!target_file) {
                return;
				// It's an unresolved link, so we add a node for it
				// But still do it safely, as a previous file may point to the same unresolved node
				// results.nodes.push(
				// 	new GCNodeData(
				// 		target_path,
				// 		[],
				// 		false,
				// 		false,
				// 		false,
				// 	)
				// );
			}

			// If the file exists, we should have already added a node for it in the simple loop over all markdown files
			results.edges.push(
				new GCEdgeData(
					source_path,
					target_path,
					field,
					edge_source,
				)
			);
		});
}

import type { RenderContext, Screen } from "./types.js";

/**
 * Authoring wrapper for the common case: a screen that renders to an HTML
 * string. The base `Screen` contract renders straight to a PNG buffer (so
 * non-HTML plugins -- e.g. proxying/passing through a pre-made PNG -- can
 * implement it directly); `htmlScreen` covers everything else by handing
 * `ctx.html()` the markup and returning its result.
 */
export function htmlScreen(def: {
  name: string;
  renderHTML(ctx: RenderContext): string | Promise<string>;
}): Screen {
  return {
    name: def.name,
    async render(ctx: RenderContext): Promise<Buffer> {
      return ctx.html(await def.renderHTML(ctx));
    },
  };
}

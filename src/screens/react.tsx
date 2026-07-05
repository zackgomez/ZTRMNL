import type { ReactNode } from "react";
import { renderElement } from "../render.js";
import type { RenderContext, Screen } from "./types.js";

/**
 * Authoring wrapper for JSX screens -- the preferred path. Satori consumes
 * React elements natively (satori-html is an adapter for the HTML-string
 * path, not the core), so `render()` returns a plain element tree and this
 * wrapper hands it straight to `renderElement` at the context's dimensions.
 *
 * Compared to htmlScreen, two satori dialect rules disappear (no inter-tag
 * whitespace to minify, no HTML entities -- JSX strings are literal text);
 * the flexbox rules still apply (see README "Satori HTML dialect rules").
 * No react-dom, no hooks, no state: components here are pure functions
 * called once per render.
 */
export function reactScreen(def: {
  name: string;
  render(ctx: RenderContext): ReactNode | Promise<ReactNode>;
}): Screen {
  return {
    name: def.name,
    async render(ctx: RenderContext): Promise<Buffer> {
      return renderElement(await def.render(ctx), ctx.width, ctx.height);
    },
  };
}

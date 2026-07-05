import { config } from "../config.js";
import { nasScreen } from "./nas.js";
import type { Screen } from "./types.js";

export type { Screen, RenderContext } from "./types.js";
export { htmlScreen } from "./html.js";

export const screens: Record<string, Screen> = {
  [nasScreen.name]: nasScreen,
};

/**
 * Resolve a screen by name, falling back to config.activeScreen when no name
 * is given (per-device assignment with a global default). Throws with a
 * helpful list if the name isn't registered.
 */
export function resolveScreen(name?: string | null): Screen {
  const wanted = name ?? config.activeScreen;
  const screen = screens[wanted];
  if (!screen) {
    throw new Error(
      `Unknown screen "${wanted}" -- registered screens: ${Object.keys(screens).join(", ")}`,
    );
  }
  return screen;
}

/** Returns the Screen selected by config.activeScreen (default "nas"). */
export function activeScreen(): Screen {
  return resolveScreen();
}

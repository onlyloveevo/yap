// The one place the browser driver is found (QUESTIONS.md Q145).
//
// The shell checks, the walks and the browser tests drive a real browser
// through Playwright. YAP does not install it: package.json has no dependency.
// A copy already on the machine is used, named by one setting:
//
//   YAP_PLAYWRIGHT=<a node_modules folder that holds playwright>
//
// With the setting absent, or naming a folder that holds no driver, the app's
// own ./node_modules is looked in. Where neither holds one, there is no driver:
// a browser test is reported skipped with NO_DRIVER_LINE, and a walk or a shell
// check stops with that line and a non-zero exit. Nothing passes quietly.
//
// Node built-ins only. Nothing is installed, downloaded or written here.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The setting that names the folder. */
export const DRIVER_SETTING = 'YAP_PLAYWRIGHT';

/** The one plain line said where no driver is found. */
export const NO_DRIVER_LINE =
  'No browser driver found: set YAP_PLAYWRIGHT to a node_modules folder that holds playwright, then run this again.';

/** @param {string} dir a node_modules folder */
function holdsDriver(dir) {
  try {
    return fs.statSync(path.join(dir, 'playwright', 'package.json')).isFile();
  } catch {
    return false;
  }
}

/**
 * Find the browser driver: the folder YAP_PLAYWRIGHT names, then the app's own
 * ./node_modules. A relative setting is read from the app folder.
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [root] the app folder
 * @returns {{ nodePath: string } | null} `nodePath` is the node_modules folder: give it to a child as NODE_PATH, or to loadPlaywright
 */
export function findBrowserDriver(env = process.env, root = APP_ROOT) {
  const named = env && typeof env[DRIVER_SETTING] === 'string' ? env[DRIVER_SETTING].trim() : '';
  const places = [];
  if (named) places.push(path.resolve(root, named));
  places.push(path.resolve(root, 'node_modules'));
  for (const dir of places) {
    if (holdsDriver(dir)) return { nodePath: dir };
  }
  return null;
}

/**
 * Load Playwright from the folder findBrowserDriver found, inside this process.
 * @param {{ nodePath: string } | null} driver
 * @returns {any} the playwright module (`chromium` and the rest)
 */
export function loadPlaywright(driver) {
  if (!driver || typeof driver.nodePath !== 'string') throw new Error(`There is no browser driver to load. ${NO_DRIVER_LINE}`);
  // By the package's own folder, so the folder that holds it may have any name.
  return createRequire(import.meta.url)(path.join(driver.nodePath, 'playwright'));
}

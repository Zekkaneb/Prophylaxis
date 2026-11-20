/**
 * Node resolves ES modules literally, while the app's source uses Vite's
 * extensionless imports (`from '../db'`). This hook fills that gap so a test
 * can import a src module that was written for the bundler.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CANDIDATE_SUFFIXES = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

export function resolve(specifier, context, nextResolve) {
  try {
    return nextResolve(specifier, context);
  } catch (error) {
    if (!specifier.startsWith('.') || /\.[cm]?[jt]sx?$/.test(specifier)) throw error;
    const base = new URL(specifier, context.parentURL);
    for (const suffix of CANDIDATE_SUFFIXES) {
      const candidate = `${base.href}${suffix}`;
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(candidate, context);
      }
    }
    throw error;
  }
}

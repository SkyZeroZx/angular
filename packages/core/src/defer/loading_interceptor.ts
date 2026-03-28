/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {AbstractType} from '../interface/type';
import {InjectionToken} from '../di/injection_token';
import type {EnvironmentProviders} from '../di/interface/provider';
import {makeEnvironmentProviders} from '../di/provider_collection';

/**
 * Represents a function that loads `@defer` block dependencies.
 * The function returns an array where each element is either an already-resolved dependency
 * or a `Promise` that resolves to one.
 *
 * @publicApi
 */
export type DeferDependencyFn = () => Array<Promise<unknown> | unknown>;

/**
 * Service that intercepts `@defer` block dependency loading. Implement this interface to
 * customize how deferred dependencies are fetched — for example, to add a retry strategy
 * or cache-busting logic that can recover from transient network failures.
 *
 * @usageNotes
 *
 * ### Why cache busting is needed
 *
 * Browsers cache failed ESM `import()` resolutions per the
 * [HTML spec](https://html.spec.whatwg.org/#fetch-a-single-module-script).
 * A subsequent call to `loadDependencies()` returns the cached failure without
 * making a new network request. Use {@link retryLoadDeferDependencies} to create
 * a cache-busted retry that appends a unique query parameter to the import URL.
 *
 * ### Custom retry strategy
 *
 * ```typescript
 * @Injectable({providedIn: 'root'})
 * class RetryDeferLoadingInterceptor implements DeferBlockLoadingInterceptor {
 *   intercept(loadDependencies: DeferDependencyFn): ReturnType<DeferDependencyFn> {
 *     return loadDependencies().map((dep, index) => {
 *       if (!(dep instanceof Promise)) return dep;
 *       return dep.catch(() => this.retry(loadDependencies, index, 1));
 *     });
 *   }
 *
 *   private retry(
 *     loadDependencies: DeferDependencyFn,
 *     index: number,
 *     attempt: number,
 *   ): Promise<unknown> {
 *     if (attempt > 3) return Promise.reject(new Error('Max retries exceeded'));
 *     return new Promise((r) => setTimeout(r, 1000)).then(() =>
 *       // Cache-busted retry — creates a fresh import() with a unique URL.
 *       retryLoadDeferDependencies(loadDependencies, index, attempt).catch(() =>
 *         this.retry(loadDependencies, index, attempt + 1),
 *       ),
 *     );
 *   }
 * }
 * ```
 *
 * Register it with `bootstrapApplication`:
 *
 * ```typescript
 * bootstrapApplication(App, {
 *   providers: [provideDeferBlockLoadingInterceptor(RetryDeferLoadingInterceptor)],
 * });
 * ```
 *
 * @publicApi
 *
 * @see {@link retryLoadDeferDependencies}
 */
export interface DeferBlockLoadingInterceptor {
  /**
   * Called when a `@defer` block is about to load its dependencies.
   *
   * `loadDependencies` is the compiler-generated resolver function that, when called, returns an
   * array of promises (or resolved values) for each dependency in the block. The interceptor
   * receives this function and must return the array (possibly with modified promises) that will
   * be awaited via `Promise.allSettled`.
   *
   * The interceptor is responsible for calling `loadDependencies()` itself. This design lets
   * implementations wrap individual import promises (for retry / cache busting) without having
   * to reconstruct the dependency list.
   *
   * @param loadDependencies The compiler-generated dependency resolver function.
   * @returns The array of promises/values to await for the block to load.
   */
  intercept(loadDependencies: DeferDependencyFn): ReturnType<DeferDependencyFn>;
}

/**
 * **INTERNAL** – injection token for the `DeferBlockLoadingInterceptor`.
 * Not part of the public API; use `provideDeferBlockLoadingInterceptor` to configure it.
 */
export const DEFER_BLOCK_LOADING_INTERCEPTOR =
  /* @__PURE__ */ new InjectionToken<DeferBlockLoadingInterceptor>(
    ngDevMode ? 'DEFER_BLOCK_LOADING_INTERCEPTOR' : '',
    {factory: () => new DefaultDeferBlockLoadingInterceptor()},
  );

/**
 * Configures Angular to use the given class or token as the `DeferBlockLoadingInterceptor`.
 *
 * The provided token must be available from the root injector and its value must implement the
 * `DeferBlockLoadingInterceptor` interface. The interceptor is invoked for every `@defer` block
 * at the moment its dependencies begin loading.
 *
 * @publicApi
 *
 * @see {@link retryLoadDeferDependencies}
 */
export function provideDeferBlockLoadingInterceptor(
  useExisting:
    | AbstractType<DeferBlockLoadingInterceptor>
    | InjectionToken<DeferBlockLoadingInterceptor>,
): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: DEFER_BLOCK_LOADING_INTERCEPTOR,
      useExisting,
    },
  ]);
}

/**
 * Default pass-through implementation of `DEFER_BLOCK_LOADING_INTERCEPTOR`.
 * Simply invokes the dependency resolver function and returns its result unchanged.
 */
class DefaultDeferBlockLoadingInterceptor implements DeferBlockLoadingInterceptor {
  intercept(loadDependencies: DeferDependencyFn): ReturnType<DeferDependencyFn> {
    return loadDependencies();
  }
}

// ---------------------------------------------------------------------------
// Cache-busting retry utility
// ---------------------------------------------------------------------------

/** Parsed metadata for a single deferrable dependency. */
interface ParsedDeferDep {
  importPath: string;
  symbolName: string;
}

/**
 * Cache for parsed dependency resolver functions.
 * Parsing `fn.toString()` is relatively expensive so we cache the result.
 */
const parsedFnCache = new WeakMap<Function, Map<number, ParsedDeferDep> | null>();

/**
 * Counts commas at the top nesting level of the given string, ignoring commas
 * inside parentheses, brackets, or template literals.
 */
function countTopLevelCommas(s: string): number {
  let count = 0;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    // ( [ {
    if (ch === 0x28 || ch === 0x5b || ch === 0x7b) depth++;
    // ) ] }
    else if (ch === 0x29 || ch === 0x5d || ch === 0x7d) depth--;
    // ,
    else if (ch === 0x2c && depth === 0) count++;
  }
  return count;
}

/**
 * Extracts import paths and export symbol names from a compiler-generated
 * dependency resolver function by parsing its source representation.
 *
 * Returns a `Map<index, metadata>` where `index` is the position in the array
 * returned by the resolver and `metadata` contains `importPath` and `symbolName`.
 * Only deferrable (dynamic import) dependencies are included; eagerly-referenced
 * dependencies are omitted (they don't need cache busting).
 *
 * Returns `null` if parsing fails.
 */
function parseDeferDependencyFn(fn: DeferDependencyFn): Map<number, ParsedDeferDep> | null {
  if (parsedFnCache.has(fn)) return parsedFnCache.get(fn)!;

  let result: Map<number, ParsedDeferDep> | null = null;
  try {
    const source = fn.toString();
    const start = source.indexOf('[');
    const end = source.lastIndexOf(']');
    if (start === -1 || end === -1) {
      parsedFnCache.set(fn, null);
      return null;
    }

    const content = source.substring(start + 1, end);
    const importPattern = /import\(["']([^"']+)["']\)\.then\(\(?\w+\)?\s*=>\s*\w+\.(\w+)\)/g;
    let match: RegExpExecArray | null;
    const map = new Map<number, ParsedDeferDep>();

    while ((match = importPattern.exec(content)) !== null) {
      const index = countTopLevelCommas(content.substring(0, match.index));
      map.set(index, {importPath: match[1], symbolName: match[2]});
    }

    result = map.size > 0 ? map : null;
  } catch {
    result = null;
  }
  parsedFnCache.set(fn, result);
  return result;
}

/**
 * Retries loading a single `@defer` block dependency with URL-level cache busting.
 *
 * Browsers cache failed ESM `import()` resolutions per the HTML spec.
 * Simply re-calling `loadDependencies()` returns the cached failure without
 * making a new network request. This utility appends a unique query parameter
 * (`_ngRetry=<attempt>`) to the import URL so the browser treats it as a new
 * module specifier, bypassing the cached failure.
 *
 * Use this inside a {@link DeferBlockLoadingInterceptor} to implement retry
 * strategies that survive transient network failures.
 *
 * @usageNotes
 *
 * ```typescript
 * @Injectable({providedIn: 'root'})
 * class RetryInterceptor implements DeferBlockLoadingInterceptor {
 *   intercept(loadDependencies: DeferDependencyFn): ReturnType<DeferDependencyFn> {
 *     return loadDependencies().map((dep, i) => {
 *       if (!(dep instanceof Promise)) return dep;
 *       return dep.catch(() => this.retry(loadDependencies, i, 1));
 *     });
 *   }
 *
 *   private retry(fn: DeferDependencyFn, i: number, attempt: number): Promise<unknown> {
 *     if (attempt > 3) return Promise.reject(new Error('Max retries exceeded'));
 *     return new Promise(r => setTimeout(r, 1000 * attempt)).then(() =>
 *       retryLoadDeferDependencies(fn, i, attempt)
 *         .catch(() => this.retry(fn, i, attempt + 1)),
 *     );
 *   }
 * }
 * ```
 *
 * @param loadDependencies The compiler-generated dependency resolver function
 *   that was passed to {@link DeferBlockLoadingInterceptor.intercept}.
 * @param index Zero-based index of the dependency in the array returned by
 *   `loadDependencies()`.
 * @param attempt A positive integer identifying the retry attempt. Each value
 *   produces a unique cache-busting URL.
 * @returns A `Promise` that resolves to the dependency (component, directive,
 *   or pipe class) on success.
 *
 * @publicApi
 */
export function retryLoadDeferDependencies(
  loadDependencies: DeferDependencyFn,
  index: number,
  attempt: number,
): Promise<unknown> {
  const parsed = parseDeferDependencyFn(loadDependencies);
  const dep = parsed?.get(index);

  if (dep) {
    const separator = dep.importPath.includes('?') ? '&' : '?';
    const url = `${dep.importPath}${separator}_ngRetry=${attempt}`;
    return /* @vite-ignore */ import(url).then((m) =>
      dep.symbolName === 'default' ? m.default : m[dep.symbolName],
    );
  }

  // Fallback: re-invoke the resolver. Works in environments where the bundler
  // transforms import() to its own chunk-loading mechanism (e.g. webpack)
  // which doesn't suffer from the ESM module-map caching issue.
  const result = loadDependencies()[index];
  return result instanceof Promise ? result : Promise.resolve(result);
}

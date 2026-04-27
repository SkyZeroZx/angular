/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {ɵisPromise as isPromise} from '@angular/core';
import {from, isObservable, Observable, of} from 'rxjs';
import {firstValueFrom} from './first_value_from';

export function shallowEqualArrays(a: readonly any[], b: readonly any[], depth = 1): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; ++i) {
    if (!shallowEqual(a[i], b[i], depth)) return false;
  }
  return true;
}

export function shallowEqual(
  a: {[key: string | symbol]: any},
  b: {[key: string | symbol]: any},
  depth = 1,
): boolean {
  if (depth <= 0) {
    return a === b;
  }

  // While `undefined` should never be possible, it would sometimes be the case in IE 11
  // and pre-chromium Edge. The check below accounts for this edge case.
  const k1 = a ? getDataKeys(a) : undefined;
  const k2 = b ? getDataKeys(b) : undefined;
  if (!k1 || !k2 || k1.length != k2.length) {
    return false;
  }
  let key: string | symbol;
  for (let i = 0; i < k1.length; i++) {
    key = k1[i];
    if (!equalArraysOrString(a[key], b[key], depth)) {
      return false;
    }
  }
  return true;
}

/**
 * Gets the keys of an object, including `symbol` keys.
 */
export function getDataKeys(obj: Object): Array<string | symbol> {
  return [...Object.keys(obj), ...Object.getOwnPropertySymbols(obj)];
}

/**
 * Test equality for parameter values, retaining existing array-of-strings comparison behavior.
 */
export function equalArraysOrString(a: any, b: any, depth = 1): boolean {
  if (a === b) {
    return true;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    if (depth > 1 && shouldCompareArrayElements(a, b)) {
      return equalArrayElements(a, b, depth);
    }
    const aSorted = [...a].sort();
    const bSorted = [...b].sort();
    return aSorted.every((val, index) => bSorted[index] === val);
  }

  if (depth > 1 && isPlainObject(a) && isPlainObject(b)) {
    return shallowEqual(a, b, depth - 1);
  }

  return a === b;
}

function equalArrayElements(a: readonly any[], b: readonly any[], depth: number): boolean {
  if (a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i++) {
    if (!equalArraysOrString(a[i], b[i], depth)) {
      return false;
    }
  }

  return true;
}

function shouldCompareArrayElements(a: readonly any[], b: readonly any[]): boolean {
  return a.some(canCompareDeeply) || b.some(canCompareDeeply);
}

function canCompareDeeply(value: any): boolean {
  return Array.isArray(value) || isPlainObject(value);
}

function isPlainObject(value: any): value is {[key: string | symbol]: any} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Return the last element of an array.
 */
export function last<T>(a: readonly T[]): T | null {
  return a.length > 0 ? a[a.length - 1] : null;
}

export function wrapIntoObservable<T>(value: T | Promise<T> | Observable<T>): Observable<T> {
  if (isObservable(value)) {
    return value;
  }

  if (isPromise(value)) {
    // Use `Promise.resolve()` to wrap promise-like instances.
    // Required ie when a Resolver returns a AngularJS `$q` promise to correctly trigger the
    // change detection.
    return from(Promise.resolve(value));
  }

  return of(value);
}

export function wrapIntoPromise<T>(value: T | Promise<T> | Observable<T>): Promise<T> {
  if (isObservable(value)) {
    return firstValueFrom(value);
  }
  return Promise.resolve(value);
}

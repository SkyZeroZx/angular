/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {
  ɵformatRuntimeError as formatRuntimeError,
  ɵIMAGE_CONFIG_DEFAULTS as IMAGE_CONFIG_DEFAULTS,
  ɵImageConfig as ImageConfig,
  ɵRuntimeError as RuntimeError,
  ɵSafeValue as SafeValue,
  SimpleChanges,
  ɵunwrapSafeValue as unwrapSafeValue,
} from '@angular/core';

import {RuntimeErrorCode} from '../../errors';

import {imgDirectiveDetails, sourceDirectiveDetails} from './error_helper';
import {cloudinaryLoaderInfo} from './image_loaders/cloudinary_loader';
import {ImageLoader, ImageLoaderConfig, noopImageLoader} from './image_loaders/image_loader';
import {imageKitLoaderInfo} from './image_loaders/imagekit_loader';
import {imgixLoaderInfo} from './image_loaders/imgix_loader';
import {netlifyLoaderInfo} from './image_loaders/netlify_loader';

/**
 * When a Base64-encoded image is passed as an input to an optimized image directive,
 * an error is thrown. The image content (as a string) might be very long, thus making
 * it hard to read an error message if the entire string is included. This const defines
 * the number of characters that should be included into the error message. The rest
 * of the content is truncated.
 */
const BASE64_IMG_MAX_LENGTH_IN_ERROR = 50;

/**
 * RegExpr to determine whether a src in a srcset is using width descriptors.
 * Should match something like: "100w, 200w".
 */
export const VALID_WIDTH_DESCRIPTOR_SRCSET = /^((\s*\d+w\s*(,|$)){1,})$/;

/**
 * RegExpr to determine whether a src in a srcset is using density descriptors.
 * Should match something like: "1x, 2x, 50x". Also supports decimals like "1.5x, 1.50x".
 */
export const VALID_DENSITY_DESCRIPTOR_SRCSET = /^((\s*\d+(\.\d+)?x\s*(,|$)){1,})$/;

/**
 * Srcset values with a density descriptor higher than this value will actively
 * throw an error. Such densities are not permitted as they cause image sizes
 * to be unreasonably large and slow down LCP.
 */
export const ABSOLUTE_SRCSET_DENSITY_CAP = 3;

/**
 * Used only in error message text to communicate best practices, as we will
 * only throw based on the slightly more conservative ABSOLUTE_SRCSET_DENSITY_CAP.
 */
export const RECOMMENDED_SRCSET_DENSITY_CAP = 2;

/**
 * Used in generating automatic density-based srcsets.
 */
export const DENSITY_SRCSET_MULTIPLIERS = [1, 2];

/**
 * Used to determine which breakpoints to use on full-width images.
 */
export const VIEWPORT_BREAKPOINT_CUTOFF = 640;

/**
 * Used to limit automatic srcset generation of very large sources for
 * fixed-size images. In pixels.
 */
export const FIXED_SRCSET_WIDTH_LIMIT = 1920;
export const FIXED_SRCSET_HEIGHT_LIMIT = 1080;

/** Info about built-in loaders we can test for. */
export const BUILT_IN_LOADERS = [
  imgixLoaderInfo,
  imageKitLoaderInfo,
  cloudinaryLoaderInfo,
  netlifyLoaderInfo,
];

export type OptimizedImageLoaderContext = {
  width?: number;
  height?: number;
  loaderParams?: {[key: string]: any};
};

export type OptimizedImageDirectiveContext = {
  directiveName: 'NgOptimizedImage' | 'NgOptimizedSource';
  elementName: 'image' | 'source';
  nativeSrcAttribute: 'src' | 'srcset';
  details: (ngSrc: string, includeNgSrc?: boolean) => string;
};

export const IMAGE_DIRECTIVE_CONTEXT: OptimizedImageDirectiveContext = {
  directiveName: 'NgOptimizedImage',
  elementName: 'image',
  nativeSrcAttribute: 'src',
  details: imgDirectiveDetails,
};

export const SOURCE_DIRECTIVE_CONTEXT: OptimizedImageDirectiveContext = {
  directiveName: 'NgOptimizedSource',
  elementName: 'source',
  nativeSrcAttribute: 'srcset',
  details: sourceDirectiveDetails,
};

/**
 * Sorts provided config breakpoints and uses defaults.
 */
export function processConfig(config: ImageConfig): ImageConfig {
  let sortedBreakpoints: {breakpoints?: number[]} = {};
  if (config.breakpoints) {
    sortedBreakpoints.breakpoints = config.breakpoints.sort((a, b) => a - b);
  }
  return Object.assign({}, IMAGE_CONFIG_DEFAULTS, config, sortedBreakpoints);
}

export function callImageLoader(
  imageLoader: ImageLoader,
  dir: OptimizedImageLoaderContext,
  configWithoutCustomParams: Omit<ImageLoaderConfig, 'loaderParams'>,
): string {
  let augmentedConfig: ImageLoaderConfig = configWithoutCustomParams;
  if (dir.loaderParams) {
    augmentedConfig.loaderParams = dir.loaderParams;
  }
  // Calculate height if width is provided and aspect ratio is available.
  const ratio = getAspectRatio(dir);
  if (ratio !== null && augmentedConfig.width) {
    augmentedConfig.height = Math.round(augmentedConfig.width / ratio);
  }
  return imageLoader(augmentedConfig);
}

/**
 * Verifies that the `ngSrc` is not a Base64-encoded image.
 */
export function assertNotBase64Image(ngSrc: string, context: OptimizedImageDirectiveContext): void {
  let source = ngSrc.trim();
  if (source.startsWith('data:')) {
    if (source.length > BASE64_IMG_MAX_LENGTH_IN_ERROR) {
      source = source.substring(0, BASE64_IMG_MAX_LENGTH_IN_ERROR) + '...';
    }
    throw new RuntimeError(
      RuntimeErrorCode.INVALID_INPUT,
      `${context.details(ngSrc, false)} \`ngSrc\` is a Base64-encoded string ` +
        `(${source}). ${context.directiveName} does not support Base64-encoded strings. ` +
        `To fix this, disable the ${context.directiveName} directive for this element ` +
        `by removing \`ngSrc\` and using a standard \`${context.nativeSrcAttribute}\` attribute instead.`,
    );
  }
}

/**
 * Verifies that the 'sizes' only includes responsive values.
 */
export function assertNoComplexSizes(
  ngSrc: string,
  sizes: string | undefined,
  context: OptimizedImageDirectiveContext,
): void {
  if (sizes?.match(/((\)|,)\s|^)\d+px/)) {
    throw new RuntimeError(
      RuntimeErrorCode.INVALID_INPUT,
      `${context.details(ngSrc, false)} \`sizes\` was set to a string including ` +
        `pixel values. For automatic \`srcset\` generation, \`sizes\` must only include responsive ` +
        `values, such as \`sizes="50vw"\` or \`sizes="(min-width: 768px) 50vw, 100vw"\`. ` +
        `To fix this, modify the \`sizes\` attribute, or provide your own \`ngSrcset\` value directly.`,
    );
  }
}

/**
 * Verifies that the `ngSrc` is not a Blob URL.
 */
export function assertNotBlobUrl(ngSrc: string, context: OptimizedImageDirectiveContext): void {
  const source = ngSrc.trim();
  if (source.startsWith('blob:')) {
    throw new RuntimeError(
      RuntimeErrorCode.INVALID_INPUT,
      `${context.details(ngSrc)} \`ngSrc\` was set to a blob URL (${source}). ` +
        `Blob URLs are not supported by the ${context.directiveName} directive. ` +
        `To fix this, disable the ${context.directiveName} directive for this element ` +
        `by removing \`ngSrc\` and using a regular \`${context.nativeSrcAttribute}\` attribute instead.`,
    );
  }
}

/**
 * Verifies that the input is set to a non-empty string.
 */
export function assertNonEmptyInput(
  ngSrc: string,
  name: string,
  value: unknown,
  context: OptimizedImageDirectiveContext,
): void {
  const isString = typeof value === 'string';
  const isEmptyString = isString && value.trim() === '';
  if (!isString || isEmptyString) {
    throw new RuntimeError(
      RuntimeErrorCode.INVALID_INPUT,
      `${context.details(ngSrc)} \`${name}\` has an invalid value ` +
        `(\`${value}\`). To fix this, change the value to a non-empty string.`,
    );
  }
}

/**
 * Verifies that the `ngSrcset` is in a valid format, e.g. "100w, 200w" or "1x, 2x".
 */
export function assertValidNgSrcsetValue(
  ngSrc: string,
  value: unknown,
  context: OptimizedImageDirectiveContext,
): void {
  if (value == null) return;
  assertNonEmptyInput(ngSrc, 'ngSrcset', value, context);
  const stringVal = value as string;
  const isValidWidthDescriptor = VALID_WIDTH_DESCRIPTOR_SRCSET.test(stringVal);
  const isValidDensityDescriptor = VALID_DENSITY_DESCRIPTOR_SRCSET.test(stringVal);

  if (isValidDensityDescriptor) {
    assertUnderDensityCap(ngSrc, stringVal, context);
  }

  const isValidSrcset = isValidWidthDescriptor || isValidDensityDescriptor;
  if (!isValidSrcset) {
    throw new RuntimeError(
      RuntimeErrorCode.INVALID_INPUT,
      `${context.details(ngSrc)} \`ngSrcset\` has an invalid value (\`${value}\`). ` +
        `To fix this, supply \`ngSrcset\` using a comma-separated list of one or more width ` +
        `descriptors (e.g. "100w, 200w") or density descriptors (e.g. "1x, 2x").`,
    );
  }
}

/**
 * Verify that none of the listed inputs has changed.
 */
export function assertNoPostInitInputChange(
  ngSrc: string,
  changes: SimpleChanges,
  inputs: string[],
  context: OptimizedImageDirectiveContext,
): void {
  inputs.forEach((input) => {
    const isUpdated = changes.hasOwnProperty(input);
    if (isUpdated && !changes[input].isFirstChange()) {
      throw postInitInputChangeError(ngSrc, input, context);
    }
  });
}

/**
 * Verifies that an input has not changed after the directive has initialized.
 */
export function assertNoPostInitSignalInputChange(
  ngSrc: string,
  inputName: string,
  context: OptimizedImageDirectiveContext,
): void {
  throw postInitInputChangeError(ngSrc, inputName, context);
}

/**
 * Verifies that a specified input is a number greater than 0.
 */
export function assertGreaterThanZero(
  ngSrc: string,
  inputValue: unknown,
  inputName: string,
  context: OptimizedImageDirectiveContext,
): void {
  const validNumber = typeof inputValue === 'number' && inputValue > 0;
  const validString =
    typeof inputValue === 'string' && /^\d+$/.test(inputValue.trim()) && parseInt(inputValue) > 0;
  if (!validNumber && !validString) {
    throw new RuntimeError(
      RuntimeErrorCode.INVALID_INPUT,
      `${context.details(ngSrc)} \`${inputName}\` has an invalid value. ` +
        `To fix this, provide \`${inputName}\` as a number greater than 0.`,
    );
  }
}

/**
 * Warns if NOT using a loader (falling back to the generic loader) and
 * the image appears to be hosted on one of the image CDNs for which
 * we do have a built-in image loader. Suggests switching to the
 * built-in loader.
 *
 * @param ngSrc Value of the ngSrc attribute
 * @param imageLoader ImageLoader provided
 */
export function assertNotMissingBuiltInLoader(ngSrc: string, imageLoader: ImageLoader): void {
  if (imageLoader === noopImageLoader) {
    let builtInLoaderName = '';
    for (const loader of BUILT_IN_LOADERS) {
      if (loader.testUrl(ngSrc)) {
        builtInLoaderName = loader.name;
        break;
      }
    }
    if (builtInLoaderName) {
      console.warn(
        formatRuntimeError(
          RuntimeErrorCode.MISSING_BUILTIN_LOADER,
          `NgOptimizedImage: It looks like your images may be hosted on the ` +
            `${builtInLoaderName} CDN, but your app is not using Angular's ` +
            `built-in loader for that CDN. We recommend switching to use ` +
            `the built-in by calling \`provide${builtInLoaderName}Loader()\` ` +
            `in your \`providers\` and passing it your instance's base URL. ` +
            `If you don't want to use the built-in loader, define a custom ` +
            `loader function using IMAGE_LOADER to silence this warning.`,
        ),
      );
    }
  }
}

/**
 * Warns if ngSrcset is present and no loader is configured (i.e. the default one is being used).
 */
export function assertNoNgSrcsetWithoutLoader(
  ngSrc: string,
  ngSrcset: string | undefined,
  imageLoader: ImageLoader,
  context: OptimizedImageDirectiveContext,
): void {
  if (ngSrcset && imageLoader === noopImageLoader) {
    console.warn(
      formatRuntimeError(
        RuntimeErrorCode.MISSING_NECESSARY_LOADER,
        `${context.details(ngSrc)} the \`ngSrcset\` attribute is present but ` +
          `no image loader is configured (i.e. the default one is being used), ` +
          `which would result in the same image being used for all configured sizes. ` +
          `To fix this, provide a loader or remove the \`ngSrcset\` attribute from the ${context.elementName}.`,
      ),
    );
  }
}

/**
 * Warns if loaderParams is present and no loader is configured (i.e. the default one is being
 * used).
 */
export function assertNoLoaderParamsWithoutLoader(
  ngSrc: string,
  loaderParams: {[key: string]: any} | undefined,
  imageLoader: ImageLoader,
  context: OptimizedImageDirectiveContext,
): void {
  if (loaderParams && imageLoader === noopImageLoader) {
    console.warn(
      formatRuntimeError(
        RuntimeErrorCode.MISSING_NECESSARY_LOADER,
        `${context.details(ngSrc)} the \`loaderParams\` attribute is present but ` +
          `no image loader is configured (i.e. the default one is being used), ` +
          `which means that the loaderParams data will not be consumed and will not affect the URL. ` +
          `To fix this, provide a custom loader or remove the \`loaderParams\` attribute from the ${context.elementName}.`,
      ),
    );
  }
}

// Transform function to handle SafeValue input for ngSrc. This doesn't do any sanitization,
// as that is not needed for img.src and img.srcset. This transform is purely for compatibility.
export function unwrapSafeUrl(value: string | SafeValue): string {
  if (typeof value === 'string') {
    return value;
  }
  return unwrapSafeValue(value);
}

/**
 * Calculates the aspect ratio of the image based on width and height.
 * Returns null if the aspect ratio cannot be calculated (missing dimensions or height is 0).
 */
function getAspectRatio(dir: OptimizedImageLoaderContext): number | null {
  if (dir.width && dir.height && dir.height !== 0) {
    return dir.width / dir.height;
  }
  return null;
}

function assertUnderDensityCap(
  ngSrc: string,
  value: string,
  context: OptimizedImageDirectiveContext,
): void {
  const underDensityCap = value
    .split(',')
    .every((num) => num === '' || parseFloat(num) <= ABSOLUTE_SRCSET_DENSITY_CAP);
  if (!underDensityCap) {
    throw new RuntimeError(
      RuntimeErrorCode.INVALID_INPUT,
      `${context.details(ngSrc)} the \`ngSrcset\` contains an unsupported image density:` +
        `\`${value}\`. NgOptimizedImage generally recommends a max image density of ` +
        `${RECOMMENDED_SRCSET_DENSITY_CAP}x but supports image densities up to ` +
        `${ABSOLUTE_SRCSET_DENSITY_CAP}x. The human eye cannot distinguish between image densities ` +
        `greater than ${RECOMMENDED_SRCSET_DENSITY_CAP}x - which makes them unnecessary for ` +
        `most use cases. Images that will be pinch-zoomed are typically the primary use case for ` +
        `${ABSOLUTE_SRCSET_DENSITY_CAP}x images. Please remove the high density descriptor and try again.`,
    );
  }
}

/**
 * Creates a `RuntimeError` instance to represent a situation when an input is set after
 * the directive has initialized.
 */
function postInitInputChangeError(
  ngSrc: string,
  inputName: string,
  context: OptimizedImageDirectiveContext,
): {} {
  let reason!: string;
  if (inputName === 'width' || inputName === 'height') {
    reason =
      `Changing \`${inputName}\` may result in different attribute value ` +
      `applied to the underlying image element and cause layout shifts on a page.`;
  } else {
    reason =
      `Changing the \`${inputName}\` would have no effect on the underlying ` +
      `image element, because the resource loading has already occurred.`;
  }
  return new RuntimeError(
    RuntimeErrorCode.UNEXPECTED_INPUT_CHANGE,
    `${context.details(ngSrc)} \`${inputName}\` was updated after initialization. ` +
      `The ${context.directiveName} directive will not react to this input change. ${reason} ` +
      `To fix this, either switch \`${inputName}\` to a static value ` +
      `or wrap the image element in an @if that is gated on the necessary value.`,
  );
}

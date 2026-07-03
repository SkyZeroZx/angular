/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {
  booleanAttribute,
  Directive,
  ElementRef,
  effect,
  ɵIMAGE_CONFIG as IMAGE_CONFIG,
  ɵImageConfig as ImageConfig,
  inject,
  Injector,
  input,
  numberAttribute,
  OnInit,
  ɵperformanceMarkFeature as performanceMarkFeature,
  Renderer2,
  ɵRuntimeError as RuntimeError,
  ɵSafeValue as SafeValue,
} from '@angular/core';

import {RuntimeErrorCode} from '../../errors';

import {IMAGE_LOADER, ImageLoaderConfig, noopImageLoader} from './image_loaders/image_loader';
import {PreloadLinkCreator} from './preload-link-creator';
import {
  assertGreaterThanZero,
  assertNoComplexSizes,
  assertNoLoaderParamsWithoutLoader,
  assertNoNgSrcsetWithoutLoader,
  assertNoPostInitSignalInputChange,
  assertNonEmptyInput,
  assertNotBase64Image,
  assertNotBlobUrl,
  assertNotMissingBuiltInLoader,
  assertValidNgSrcsetValue,
  callImageLoader,
  DENSITY_SRCSET_MULTIPLIERS,
  FIXED_SRCSET_HEIGHT_LIMIT,
  FIXED_SRCSET_WIDTH_LIMIT,
  processConfig,
  SOURCE_DIRECTIVE_CONTEXT,
  unwrapSafeUrl,
  VALID_DENSITY_DESCRIPTOR_SRCSET,
  VALID_WIDTH_DESCRIPTOR_SRCSET,
  VIEWPORT_BREAKPOINT_CUTOFF,
} from './shared';

const POST_INIT_INPUT_NAMES = [
  'ngSrcset',
  'width',
  'height',
  'priority',
  'sizes',
  'loaderParams',
  'disableOptimizedSrcset',
  'media',
  'type',
] as const;

type SourcePostInitInputName = (typeof POST_INIT_INPUT_NAMES)[number];

type SourceInputSnapshot = Record<SourcePostInitInputName, unknown>;

/**
 * Directive that optimizes `<source>` elements inside a native `<picture>` element.
 *
 * The directive uses the configured `ImageLoader` to write the final `srcset` attribute while the
 * companion fallback `<img ngSrc>` keeps owning layout, loading, LCP checks, and placeholders.
 *
 * @usageNotes
 *
 * ```html
 * <picture>
 *   <source ngSrc="hero.avif" type="image/avif" sizes="100vw">
 *   <source ngSrc="hero.webp" type="image/webp" sizes="100vw">
 *   <img ngSrc="hero.jpg" width="1200" height="800" priority>
 * </picture>
 * ```
 *
 * @publicApi
 * @see [Image Optimization Guide](guide/image-optimization)
 */
@Directive({
  selector: 'source[ngSrc]',
})
export class NgOptimizedSource implements OnInit {
  private imageLoader = inject(IMAGE_LOADER);
  private config: ImageConfig = processConfig(inject(IMAGE_CONFIG));
  private renderer = inject(Renderer2);
  private sourceElement: HTMLSourceElement = inject(ElementRef).nativeElement;
  private injector = inject(Injector);

  /**
   * Name of the source image.
   * Image name will be processed by the image loader and the final URL will be applied as the
   * `srcset` property of the source.
   */
  readonly ngSrc = input.required<string, string | SafeValue>({transform: unwrapSafeUrl});

  /**
   * A comma separated list of width or density descriptors.
   * The image name will be taken from `ngSrc` and combined with the list of descriptors to
   * generate the final `srcset` property of the source.
   */
  readonly ngSrcset = input<string>();

  /**
   * The base `sizes` attribute passed through to the `<source>` element.
   * Providing sizes causes the source to create an automatic responsive srcset.
   */
  readonly sizes = input<string>();

  /**
   * The intrinsic width of this source image in pixels.
   */
  readonly width = input<number | undefined, unknown>(undefined, {transform: numberAttribute});

  /**
   * The intrinsic height of this source image in pixels.
   */
  readonly height = input<number | undefined, unknown>(undefined, {transform: numberAttribute});

  /**
   * Indicates whether this source should be preloaded during SSR.
   */
  readonly priority = input(false, {transform: booleanAttribute});

  /**
   * Data to pass through to custom loaders.
   */
  readonly loaderParams = input<{[key: string]: any}>();

  /**
   * Disables automatic srcset generation for this source.
   */
  readonly disableOptimizedSrcset = input(false, {transform: booleanAttribute});

  /**
   * Value of the `srcset` attribute if set on the host `<source>` element.
   * This input is exclusively read to assert that `srcset` is not set in conflict with `ngSrc`.
   * @internal
   */
  readonly srcset = input<string>();

  /**
   * The source media query. Passed to generated SSR preload links when `priority` is set.
   */
  readonly media = input<string>();

  /**
   * The source MIME type. Passed to generated SSR preload links when `priority` is set.
   */
  readonly type = input<string>();

  /**
   * Calculate the rewritten `src` once and store it.
   */
  private _renderedSrc: string | null = null;

  private initialized = false;
  private initialInputSnapshot: SourceInputSnapshot | null = null;
  private lastUpdatedNgSrc: string | null = null;

  private readonly inputChangeEffect = effect(
    () => {
      const ngSrc = this.ngSrc();
      const inputSnapshot = this.getInputSnapshot();

      if (!this.initialized) {
        return;
      }

      if (ngDevMode) {
        this.assertNoChangedPostInitInputs(ngSrc, inputSnapshot);
      }

      if (ngSrc !== this.lastUpdatedNgSrc) {
        this.updateSrcset(true);
      }
    },
    {injector: this.injector},
  );

  /** @docs-private */
  ngOnInit() {
    performanceMarkFeature('NgOptimizedSource');

    const ngSrc = this.ngSrc();
    const ngSrcset = this.ngSrcset();
    const sizes = this.sizes();
    const width = this.width();
    const height = this.height();
    const loaderParams = this.loaderParams();

    if (ngDevMode) {
      assertSourceInsidePicture(ngSrc, this.sourceElement);
      assertNonEmptyInput(ngSrc, 'ngSrc', ngSrc, SOURCE_DIRECTIVE_CONTEXT);
      assertValidNgSrcsetValue(ngSrc, ngSrcset, SOURCE_DIRECTIVE_CONTEXT);
      assertNoConflictingSourceSrcset(ngSrc, this.srcset());
      assertNotBase64Image(ngSrc, SOURCE_DIRECTIVE_CONTEXT);
      assertNotBlobUrl(ngSrc, SOURCE_DIRECTIVE_CONTEXT);
      if (!ngSrcset) {
        assertNoComplexSizes(ngSrc, sizes, SOURCE_DIRECTIVE_CONTEXT);
      }
      if (height !== undefined) {
        assertGreaterThanZero(ngSrc, height, 'height', SOURCE_DIRECTIVE_CONTEXT);
      }
      if (width !== undefined) {
        assertGreaterThanZero(ngSrc, width, 'width', SOURCE_DIRECTIVE_CONTEXT);
      }
      assertWidthPresentForDensitySrcset(ngSrc, ngSrcset, width);
      assertNotMissingBuiltInLoader(ngSrc, this.imageLoader);
      assertNoNgSrcsetWithoutLoader(ngSrc, ngSrcset, this.imageLoader, SOURCE_DIRECTIVE_CONTEXT);
      assertNoLoaderParamsWithoutLoader(
        ngSrc,
        loaderParams,
        this.imageLoader,
        SOURCE_DIRECTIVE_CONTEXT,
      );
    }

    this.setHostAttributes();
    this.initialInputSnapshot = this.getInputSnapshot();
    this.initialized = true;
  }

  private setHostAttributes() {
    const width = this.width();
    const height = this.height();
    const sizes = this.sizes();

    if (width !== undefined) {
      this.setHostAttribute('width', width.toString());
    }
    if (height !== undefined) {
      this.setHostAttribute('height', height.toString());
    }
    if (sizes) {
      this.setHostAttribute('sizes', sizes);
    }

    const rewrittenSrcset = this.updateSrcset();

    if (typeof ngServerMode !== 'undefined' && ngServerMode && this.priority()) {
      const preloadLinkCreator = this.injector.get(PreloadLinkCreator);
      preloadLinkCreator.createPreloadLinkTag(
        this.renderer,
        this.getRewrittenSrc(),
        rewrittenSrcset,
        sizes,
        this.media(),
        this.type(),
      );
    }
  }

  private callImageLoader(
    configWithoutCustomParams: Omit<ImageLoaderConfig, 'loaderParams'>,
  ): string {
    return callImageLoader(
      this.imageLoader,
      {
        width: this.width(),
        height: this.height(),
        loaderParams: this.loaderParams(),
      },
      configWithoutCustomParams,
    );
  }

  private getRewrittenSrc(): string {
    if (!this._renderedSrc) {
      this._renderedSrc = this.callImageLoader({src: this.ngSrc()});
    }
    return this._renderedSrc;
  }

  private getRewrittenSrcset(): string {
    const ngSrcset = this.ngSrcset()!;
    const widthSrcSet = VALID_WIDTH_DESCRIPTOR_SRCSET.test(ngSrcset);
    const finalSrcs = ngSrcset
      .split(',')
      .filter((src) => src !== '')
      .map((srcStr) => {
        srcStr = srcStr.trim();
        const width = widthSrcSet ? parseFloat(srcStr) : parseFloat(srcStr) * this.width()!;
        return `${this.callImageLoader({src: this.ngSrc(), width})} ${srcStr}`;
      });
    return finalSrcs.join(', ');
  }

  private getAutomaticSrcset(): string {
    if (this.sizes()) {
      return this.getResponsiveSrcset();
    } else {
      return this.getFixedSrcset();
    }
  }

  private getResponsiveSrcset(): string {
    const {breakpoints} = this.config;
    const sizes = this.sizes();

    let filteredBreakpoints = breakpoints!;
    if (sizes?.trim() === '100vw') {
      filteredBreakpoints = breakpoints!.filter((bp) => bp >= VIEWPORT_BREAKPOINT_CUTOFF);
    }

    const finalSrcs = filteredBreakpoints.map(
      (bp) => `${this.callImageLoader({src: this.ngSrc(), width: bp})} ${bp}w`,
    );
    return finalSrcs.join(', ');
  }

  private getFixedSrcset(): string {
    const finalSrcs = DENSITY_SRCSET_MULTIPLIERS.map(
      (multiplier) =>
        `${this.callImageLoader({
          src: this.ngSrc(),
          width: this.width()! * multiplier,
        })} ${multiplier}x`,
    );
    return finalSrcs.join(', ');
  }

  private updateSrcset(forceSrcRecalc = false): string {
    if (forceSrcRecalc) {
      this._renderedSrc = null;
    }

    let rewrittenSrcset: string;
    if (this.ngSrcset()) {
      rewrittenSrcset = this.getRewrittenSrcset();
    } else if (this.shouldGenerateAutomaticSrcset()) {
      rewrittenSrcset = this.getAutomaticSrcset();
    } else {
      rewrittenSrcset = this.getRewrittenSrc();
    }

    this.setHostAttribute('srcset', rewrittenSrcset);
    this.lastUpdatedNgSrc = this.ngSrc();
    return rewrittenSrcset;
  }

  private getInputSnapshot(): SourceInputSnapshot {
    return {
      ngSrcset: this.ngSrcset(),
      width: this.width(),
      height: this.height(),
      priority: this.priority(),
      sizes: this.sizes(),
      loaderParams: this.loaderParams(),
      disableOptimizedSrcset: this.disableOptimizedSrcset(),
      media: this.media(),
      type: this.type(),
    };
  }

  private assertNoChangedPostInitInputs(
    ngSrc: string,
    currentInputSnapshot: SourceInputSnapshot,
  ): void {
    const initialInputSnapshot = this.initialInputSnapshot;
    if (initialInputSnapshot === null) {
      return;
    }

    for (const inputName of POST_INIT_INPUT_NAMES) {
      if (!Object.is(currentInputSnapshot[inputName], initialInputSnapshot[inputName])) {
        assertNoPostInitSignalInputChange(ngSrc, inputName, SOURCE_DIRECTIVE_CONTEXT);
      }
    }
  }

  private shouldGenerateAutomaticSrcset(): boolean {
    const sizes = this.sizes();
    const width = this.width();
    const height = this.height();

    if (!sizes && width === undefined) {
      return false;
    }

    let oversizedImage = false;
    if (!sizes) {
      oversizedImage =
        width! > FIXED_SRCSET_WIDTH_LIMIT ||
        (height !== undefined && height > FIXED_SRCSET_HEIGHT_LIMIT);
    }
    return (
      !this.disableOptimizedSrcset() &&
      !this.srcset() &&
      this.imageLoader !== noopImageLoader &&
      !oversizedImage
    );
  }

  private setHostAttribute(name: string, value: string): void {
    this.renderer.setAttribute(this.sourceElement, name, value);
  }
}

/**
 * Verifies that there is no `srcset` set on a source host element.
 */
function assertNoConflictingSourceSrcset(ngSrc: string, srcset: string | undefined) {
  if (srcset) {
    throw new RuntimeError(
      RuntimeErrorCode.UNEXPECTED_SRCSET_ATTR,
      `${SOURCE_DIRECTIVE_CONTEXT.details(ngSrc)} both \`srcset\` and \`ngSrc\` have been set. ` +
        `The NgOptimizedSource directive sets \`srcset\` itself based on the value of ` +
        `\`ngSrc\`. To fix this, please remove the \`srcset\` attribute.`,
    );
  }
}

/**
 * Verifies that the source directive is applied to a source inside a picture element.
 */
function assertSourceInsidePicture(ngSrc: string, sourceElement: HTMLSourceElement) {
  if (sourceElement.parentElement?.tagName.toLowerCase() !== 'picture') {
    throw new RuntimeError(
      RuntimeErrorCode.INVALID_INPUT,
      `${SOURCE_DIRECTIVE_CONTEXT.details(ngSrc)} it is not inside a \`<picture>\` element. ` +
        `The NgOptimizedSource directive is only supported on \`<source>\` elements ` +
        `inside native \`<picture>\` elements.`,
    );
  }
}

/**
 * Verifies that density descriptor srcsets on sources have a width to scale from.
 */
function assertWidthPresentForDensitySrcset(
  ngSrc: string,
  ngSrcset: string | undefined,
  width: number | undefined,
) {
  if (ngSrcset && VALID_DENSITY_DESCRIPTOR_SRCSET.test(ngSrcset) && width === undefined) {
    throw new RuntimeError(
      RuntimeErrorCode.REQUIRED_INPUT_MISSING,
      `${SOURCE_DIRECTIVE_CONTEXT.details(ngSrc)} \`ngSrcset\` uses density descriptors but ` +
        `the required \`width\` attribute is missing. The width is needed to request ` +
        `scaled image candidates from the configured loader. To fix this, add a ` +
        `\`width\` attribute or use width descriptors such as "400w, 800w".`,
    );
  }
}

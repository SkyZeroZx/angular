/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {
  assertInInjectionContext,
  computed,
  effect,
  type EffectRef,
  ɵencapsulateResourceError as encapsulateResourceError,
  inject,
  Injector,
  linkedSignal,
  ɵResourceImpl as ResourceImpl,
  type ResourceParamsContext,
  ResourceStreamItem,
  Signal,
  signal,
  TransferState,
  type ValueEqualityFn,
  untracked,
  ɵRuntimeError,
  ɵRuntimeErrorCode,
} from '@angular/core';
import type {Subscription} from 'rxjs';

import {HttpClient} from './client';
import {HttpHeaders} from './headers';
import {HttpParams} from './params';
import {HttpRequest} from './request';
import {HttpResourceOptions, HttpResourceRef, HttpResourceRequest} from './resource_api';
import {HttpErrorResponse, HttpEventType, HttpProgressEvent} from './response';
import {CACHE_OPTIONS} from './transfer_cache';

/**
 * Type for the `httpRequest` top-level function, which includes the call signatures for the JSON-
 * based `httpRequest` as well as sub-functions for `ArrayBuffer`, `Blob`, and `string` type
 * requests.
 *
 * @publicApi 22.0
 */
export interface HttpResourceFn {
  /**
   * Create a `Resource` that fetches data with an HTTP GET request to the given URL.
   *
   * The resource will update when the URL changes via signals.
   *
   * Uses `HttpClient` to make requests and supports interceptors, testing, and the other features
   * of the `HttpClient` API. Data is parsed as JSON by default - use a sub-function of
   * `httpResource`, such as `httpResource.text()`, to parse the response differently.
   *
   * @publicApi 22.0
   */
  <TResult = unknown>(
    url: (ctx: ResourceParamsContext) => string | undefined,
    options: HttpResourceOptions<TResult, unknown> & {defaultValue: NoInfer<TResult>},
  ): HttpResourceRef<TResult>;

  /**
   * Create a `Resource` that fetches data with an HTTP GET request to the given URL.
   *
   * The resource will update when the URL changes via signals.
   *
   * Uses `HttpClient` to make requests and supports interceptors, testing, and the other features
   * of the `HttpClient` API. Data is parsed as JSON by default - use a sub-function of
   * `httpResource`, such as `httpResource.text()`, to parse the response differently.
   *
   * @publicApi 22.0
   */
  <TResult = unknown>(
    url: (ctx: ResourceParamsContext) => string | undefined,
    options?: HttpResourceOptions<TResult, unknown>,
  ): HttpResourceRef<TResult | undefined>;

  /**
   * Create a `Resource` that fetches data with the configured HTTP request.
   *
   * The resource will update when the request changes via signals.
   *
   * Uses `HttpClient` to make requests and supports interceptors, testing, and the other features
   * of the `HttpClient` API. Data is parsed as JSON by default - use a sub-function of
   * `httpResource`, such as `httpResource.text()`, to parse the response differently.
   *
   * @publicApi 22.0
   */
  <TResult = unknown>(
    request: (ctx: ResourceParamsContext) => HttpResourceRequest | undefined,
    options: HttpResourceOptions<TResult, unknown> & {defaultValue: NoInfer<TResult>},
  ): HttpResourceRef<TResult>;

  /**
   * Create a `Resource` that fetches data with the configured HTTP request.
   *
   * The resource will update when the request changes via signals.
   *
   * Uses `HttpClient` to make requests and supports interceptors, testing, and the other features
   * of the `HttpClient` API. Data is parsed as JSON by default - use a sub-function of
   * `httpResource`, such as `httpResource.text()`, to parse the response differently.
   *
   * @publicApi 22.0
   */
  <TResult = unknown>(
    request: (ctx: ResourceParamsContext) => HttpResourceRequest | undefined,
    options?: HttpResourceOptions<TResult, unknown>,
  ): HttpResourceRef<TResult | undefined>;

  /**
   * Create a `Resource` that fetches data with the configured HTTP request.
   *
   * The resource will update when the URL or request changes via signals.
   *
   * Uses `HttpClient` to make requests and supports interceptors, testing, and the other features
   * of the `HttpClient` API. Data is parsed into an `ArrayBuffer`.
   *
   * @publicApi 22.0
   */
  arrayBuffer: {
    <TResult = ArrayBuffer>(
      url: (ctx: ResourceParamsContext) => string | undefined,
      options: HttpResourceOptions<TResult, ArrayBuffer> & {defaultValue: NoInfer<TResult>},
    ): HttpResourceRef<TResult>;

    <TResult = ArrayBuffer>(
      url: (ctx: ResourceParamsContext) => string | undefined,
      options?: HttpResourceOptions<TResult, ArrayBuffer>,
    ): HttpResourceRef<TResult | undefined>;

    <TResult = ArrayBuffer>(
      request: (ctx: ResourceParamsContext) => HttpResourceRequest | undefined,
      options: HttpResourceOptions<TResult, ArrayBuffer> & {defaultValue: NoInfer<TResult>},
    ): HttpResourceRef<TResult>;

    <TResult = ArrayBuffer>(
      request: (ctx: ResourceParamsContext) => HttpResourceRequest | undefined,
      options?: HttpResourceOptions<TResult, ArrayBuffer>,
    ): HttpResourceRef<TResult | undefined>;
  };

  /**
   * Create a `Resource` that fetches data with the configured HTTP request.
   *
   * The resource will update when the URL or request changes via signals.
   *
   * Uses `HttpClient` to make requests and supports interceptors, testing, and the other features
   * of the `HttpClient` API. Data is parsed into a `Blob`.
   *
   * @publicApi 22.0
   */
  blob: {
    <TResult = Blob>(
      url: (ctx: ResourceParamsContext) => string | undefined,
      options: HttpResourceOptions<TResult, Blob> & {defaultValue: NoInfer<TResult>},
    ): HttpResourceRef<TResult>;

    <TResult = Blob>(
      url: (ctx: ResourceParamsContext) => string | undefined,
      options?: HttpResourceOptions<TResult, Blob>,
    ): HttpResourceRef<TResult | undefined>;

    <TResult = Blob>(
      request: (ctx: ResourceParamsContext) => HttpResourceRequest | undefined,
      options: HttpResourceOptions<TResult, Blob> & {defaultValue: NoInfer<TResult>},
    ): HttpResourceRef<TResult>;

    <TResult = Blob>(
      request: (ctx: ResourceParamsContext) => HttpResourceRequest | undefined,
      options?: HttpResourceOptions<TResult, Blob>,
    ): HttpResourceRef<TResult | undefined>;
  };

  /**
   * Create a `Resource` that fetches data with the configured HTTP request.
   *
   * The resource will update when the URL or request changes via signals.
   *
   * Uses `HttpClient` to make requests and supports interceptors, testing, and the other features
   * of the `HttpClient` API. Data is parsed as a `string`.
   *
   * @publicApi 22.0
   */
  text: {
    <TResult = string>(
      url: (ctx: ResourceParamsContext) => string | undefined,
      options: HttpResourceOptions<TResult, string> & {defaultValue: NoInfer<TResult>},
    ): HttpResourceRef<TResult>;

    <TResult = string>(
      url: (ctx: ResourceParamsContext) => string | undefined,
      options?: HttpResourceOptions<TResult, string>,
    ): HttpResourceRef<TResult | undefined>;

    <TResult = string>(
      request: (ctx: ResourceParamsContext) => HttpResourceRequest | undefined,
      options: HttpResourceOptions<TResult, string> & {defaultValue: NoInfer<TResult>},
    ): HttpResourceRef<TResult>;

    <TResult = string>(
      request: (ctx: ResourceParamsContext) => HttpResourceRequest | undefined,
      options?: HttpResourceOptions<TResult, string>,
    ): HttpResourceRef<TResult | undefined>;
  };
}

/**
 * `httpResource` makes a reactive HTTP request and exposes the request status and response value as
 * a `WritableResource`. By default, it assumes that the backend will return JSON data. To make a
 * request that expects a different kind of data, you can use a sub-constructor of `httpResource`,
 * such as `httpResource.text`.
 *
 * @publicApi 22.0
 * @initializerApiFunction
 */
export const httpResource: HttpResourceFn = (() => {
  const jsonFn = makeHttpResourceFn<unknown>('json') as HttpResourceFn;
  jsonFn.arrayBuffer = makeHttpResourceFn<ArrayBuffer>('arraybuffer');
  jsonFn.blob = makeHttpResourceFn('blob');
  jsonFn.text = makeHttpResourceFn('text');
  return jsonFn;
})();

/**
 * The expected response type of the server.
 *
 * This is used to parse the response appropriately before returning it to
 * the requestee.
 */
type ResponseType = 'arraybuffer' | 'blob' | 'json' | 'text';
type RawRequestType =
  | ((ctx: ResourceParamsContext) => string | undefined)
  | ((ctx: ResourceParamsContext) => HttpResourceRequest | undefined);

function makeHttpResourceFn<TRaw>(responseType: ResponseType) {
  return function httpResource<TResult = TRaw>(
    request: RawRequestType,
    options?: HttpResourceOptions<TResult, TRaw>,
  ): HttpResourceRef<TResult> {
    if (ngDevMode && !options?.injector) {
      assertInInjectionContext(httpResource);
    }
    const injector = options?.injector ?? inject(Injector);

    const cacheOptions = injector.get(CACHE_OPTIONS, null, {optional: true});
    const transferState = injector.get(TransferState, null, {optional: true});
    // The exact cache lookup must remain inside HttpClient so request interceptors run first.
    const mayHaveInitialResponse = () =>
      cacheOptions?.isCacheActive === true && transferState !== null && !transferState.isEmpty;

    return new HttpResourceImpl(
      injector,
      (ctx: ResourceParamsContext) => normalizeRequest(ctx, request, responseType),
      options?.defaultValue,
      options?.debugName,
      options?.parse as (value: unknown) => TResult,
      options?.equal as ValueEqualityFn<unknown>,
      mayHaveInitialResponse,
    ) as HttpResourceRef<TResult>;
  };
}

function normalizeRequest(
  ctx: ResourceParamsContext,
  request: RawRequestType,
  responseType: ResponseType,
): HttpRequest<unknown> | undefined {
  let unwrappedRequest = typeof request === 'function' ? request(ctx) : request;
  if (unwrappedRequest === undefined) {
    return undefined;
  } else if (typeof unwrappedRequest === 'string') {
    unwrappedRequest = {url: unwrappedRequest};
  }

  const headers =
    unwrappedRequest.headers instanceof HttpHeaders
      ? unwrappedRequest.headers
      : new HttpHeaders(
          unwrappedRequest.headers as
            | Record<string, string | number | Array<string | number>>
            | undefined,
        );

  const params =
    unwrappedRequest.params instanceof HttpParams
      ? unwrappedRequest.params
      : new HttpParams({fromObject: unwrappedRequest.params});

  return new HttpRequest(
    unwrappedRequest.method ?? 'GET',
    unwrappedRequest.url,
    unwrappedRequest.body ?? null,
    {
      headers,
      params,
      reportProgress: unwrappedRequest.reportProgress,
      withCredentials: unwrappedRequest.withCredentials,
      keepalive: unwrappedRequest.keepalive,
      cache: unwrappedRequest.cache as RequestCache,
      priority: unwrappedRequest.priority as RequestPriority,
      mode: unwrappedRequest.mode as RequestMode,
      redirect: unwrappedRequest.redirect as RequestRedirect,
      responseType,
      context: unwrappedRequest.context,
      transferCache: unwrappedRequest.transferCache,
      credentials: unwrappedRequest.credentials as RequestCredentials,
      referrer: unwrappedRequest.referrer,
      referrerPolicy: unwrappedRequest.referrerPolicy as ReferrerPolicy,
      integrity: unwrappedRequest.integrity,
      timeout: unwrappedRequest.timeout,
    },
  );
}
class HttpResourceImpl<T>
  extends ResourceImpl<T, HttpRequest<unknown> | undefined>
  implements HttpResourceRef<T>
{
  private client!: HttpClient;
  private initialLoad:
    | {
        request: HttpRequest<unknown>;
        result: HttpResourceLoad<T>;
      }
    | undefined;
  private initialLoadWatcher: EffectRef | undefined;
  private _headers = linkedSignal({
    source: this.extRequest,
    computation: () => undefined as HttpHeaders | undefined,
  });
  private _progress = linkedSignal({
    source: this.extRequest,
    computation: () => undefined as HttpProgressEvent | undefined,
  });
  private _statusCode = linkedSignal({
    source: this.extRequest,
    computation: () => undefined as number | undefined,
  });

  readonly headers = computed(() =>
    this.status() === 'resolved' || this.status() === 'error' ? this._headers() : undefined,
  );
  readonly progress = this._progress.asReadonly();
  readonly statusCode = this._statusCode.asReadonly();

  constructor(
    private readonly injector: Injector,
    request: (ctx: ResourceParamsContext) => HttpRequest<T> | undefined,
    defaultValue: T,
    debugName?: string,
    parse?: (value: unknown) => T,
    equal?: ValueEqualityFn<unknown>,
    mayHaveInitialResponse?: () => boolean,
  ) {
    super(
      request,
      ({params: request, abortSignal}) => {
        const initialLoad = this.clearInitialLoad();

        if (
          initialLoad?.result.synchronousStream === undefined &&
          initialLoad?.request === request
        ) {
          initialLoad.result.attachAbortSignal(abortSignal);
          return initialLoad.result.promise;
        }

        initialLoad?.result.cancel();

        const result = this.createRequest(request, parse);
        result.attachAbortSignal(abortSignal);
        return result.promise;
      },
      defaultValue,
      equal,
      debugName,
      injector,
      undefined,
      (request) => {
        if (request === undefined || !mayHaveInitialResponse?.()) {
          return undefined;
        }

        return this.startInitialRequest(request, parse);
      },
    );
    this.client = injector.get(HttpClient);
  }

  private startInitialRequest(
    request: HttpRequest<unknown>,
    parse: ((value: unknown) => T) | undefined,
  ): Signal<ResourceStreamItem<T>> | undefined {
    let parsingFailed = false;
    let initializing = true;
    const initialParse = parse
      ? (value: unknown): T => {
          try {
            return parse(value);
          } catch (error) {
            if (initializing) {
              parsingFailed = true;
              if (typeof ngDevMode === 'undefined' || ngDevMode) {
                console.warn(
                  `Angular detected an error while parsing the cached response for the httpResource at \`${request.url}\`. ` +
                    `The resource will fall back to its default value and try again asynchronously.`,
                  error,
                );
              }
            }
            throw error;
          }
        }
      : undefined;
    let completedSynchronously = false;
    let result: HttpResourceLoad<T> | undefined;
    result = this.createRequest(request, initialParse, () => {
      if (result === undefined) {
        completedSynchronously = true;
      } else if (this.initialLoad?.result === result && result.synchronousStream !== undefined) {
        this.clearInitialLoad();
      }
    });
    initializing = false;

    if (parsingFailed) {
      result.cancel();
      untracked(() => {
        this._headers.set(undefined);
        this._progress.set(undefined);
        this._statusCode.set(undefined);
      });
      return undefined;
    }

    if (result.synchronousStream && completedSynchronously) {
      return result.synchronousStream;
    }

    this.initialLoad = {
      request,
      result,
    };
    this.initialLoadWatcher = untracked(() =>
      effect(
        () => {
          const currentRequest = this.extRequest().request;
          untracked(() => {
            if (currentRequest !== request) {
              this.cancelInitialLoad();
            }
          });
        },
        {injector: this.injector},
      ),
    );

    return result.synchronousStream;
  }

  private createRequest(
    request: HttpRequest<unknown>,
    parse: ((value: unknown) => T) | undefined,
    onComplete?: () => void,
  ): HttpResourceLoad<T> {
    let sub: Subscription | undefined;
    let attachedAbortSignal: AbortSignal | undefined;
    let completed = false;
    let synchronous = true;
    let synchronousStream: Signal<ResourceStreamItem<T>> | undefined;

    const detachAbortSignal = () => {
      attachedAbortSignal?.removeEventListener('abort', cancel);
      attachedAbortSignal = undefined;
    };
    const complete = () => {
      if (completed) {
        return;
      }
      completed = true;
      detachAbortSignal();
      onComplete?.();
    };
    const cancel = () => {
      sub?.unsubscribe();
      complete();
    };

    // Start off stream as undefined.
    const stream = signal<ResourceStreamItem<T>>({value: undefined as T});
    let resolve: ((value: Signal<ResourceStreamItem<T>>) => void) | undefined;
    const promise = new Promise<Signal<ResourceStreamItem<T>>>((r) => (resolve = r));

    const send = (value: ResourceStreamItem<T>): void => {
      stream.set(value);
      if (synchronous) {
        synchronousStream = stream;
      }
      resolve?.(stream);
      resolve = undefined;
    };

    sub = untracked(() =>
      this.client.request(request).subscribe({
        next: (event) => {
          switch (event.type) {
            case HttpEventType.Response:
              this._headers.set(event.headers);
              this._statusCode.set(event.status);
              try {
                send({value: parse ? parse(event.body) : (event.body as T)});
              } catch (error) {
                send({error: encapsulateResourceError(error)});
              }
              break;
            case HttpEventType.DownloadProgress:
              this._progress.set(event);
              break;
          }
        },
        error: (error) => {
          if (error instanceof HttpErrorResponse) {
            this._headers.set(error.headers);
            this._statusCode.set(error.status);
          }

          send({error});
          complete();
        },
        complete: () => {
          if (resolve) {
            send({
              error: new ɵRuntimeError(
                ɵRuntimeErrorCode.RESOURCE_COMPLETED_BEFORE_PRODUCING_VALUE,
                ngDevMode && 'Resource completed before producing a value',
              ),
            });
          }
          complete();
        },
      }),
    );
    synchronous = false;

    return {
      promise,
      synchronousStream,
      attachAbortSignal: (abortSignal) => {
        if (completed) {
          return;
        }
        detachAbortSignal();
        attachedAbortSignal = abortSignal;
        if (abortSignal.aborted) {
          cancel();
        } else {
          abortSignal.addEventListener('abort', cancel);
        }
      },
      cancel,
    };
  }

  private clearInitialLoad() {
    const initialLoad = this.initialLoad;
    this.initialLoad = undefined;
    this.initialLoadWatcher?.destroy();
    this.initialLoadWatcher = undefined;
    return initialLoad;
  }

  private cancelInitialLoad(): void {
    this.clearInitialLoad()?.result.cancel();
  }

  override set(value: T): void {
    this.cancelInitialLoad();
    super.set(value);

    this._headers.set(undefined);
    this._progress.set(undefined);
    this._statusCode.set(undefined);
  }

  override destroy(): void {
    this.cancelInitialLoad();
    super.destroy();
  }

  // This is a type only override of the method
  declare hasValue: () => this is HttpResourceRef<Exclude<T, undefined>>;
}

interface HttpResourceLoad<T> {
  promise: Promise<Signal<ResourceStreamItem<T>>>;
  synchronousStream: Signal<ResourceStreamItem<T>> | undefined;
  attachAbortSignal(abortSignal: AbortSignal): void;
  cancel(): void;
}

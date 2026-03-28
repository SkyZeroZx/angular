import {Injectable} from '@angular/core';
import {
  DeferBlockLoadingInterceptor,
  DeferDependencyFn,
  retryLoadDeferDependencies,
} from '@angular/core';

/**
 * A demo interceptor that retries failed `@defer` block loads up to 3 times
 * with exponential backoff and jitter.
 *
 * On each retry it uses {@link retryLoadDeferDependencies} to create a
 * cache-busted `import()` with a unique query parameter. This is critical
 * because **browsers cache failed ESM import() resolutions** per the
 * HTML spec — re-requesting the same URL returns the cached failure
 * without hitting the network.
 *
 * Open the browser console to see the retry log output.
 */
@Injectable({providedIn: 'root'})
export class RetryDeferLoadingInterceptor implements DeferBlockLoadingInterceptor {
  private static readonly MAX_RETRIES = 3;
  private static readonly BASE_DELAY_MS = 1000;
  private static readonly MAX_JITTER_MS = 500;

  intercept(loadDependencies: DeferDependencyFn): ReturnType<DeferDependencyFn> {
    // First attempt — no cache busting needed (fresh import).
    return loadDependencies().map((dep, index) => {
      if (!(dep instanceof Promise)) return dep;
      return dep.catch((err) => this.retryDep(loadDependencies, index, 1, err));
    });
  }

  private retryDep(
    loadDependencies: DeferDependencyFn,
    index: number,
    attempt: number,
    lastError: unknown,
  ): Promise<unknown> {
    if (attempt > RetryDeferLoadingInterceptor.MAX_RETRIES) {
      console.error(
        `[RetryDeferLoadingInterceptor] All ${RetryDeferLoadingInterceptor.MAX_RETRIES} retries exhausted for dep #${index}.`,
        lastError,
      );
      return Promise.reject(lastError);
    }

    const delay =
      RetryDeferLoadingInterceptor.BASE_DELAY_MS * attempt +
      Math.floor(Math.random() * RetryDeferLoadingInterceptor.MAX_JITTER_MS);
    console.warn(
      `[RetryDeferLoadingInterceptor] Dep #${index} failed (attempt ${attempt}/${RetryDeferLoadingInterceptor.MAX_RETRIES}), retrying in ${delay}ms...`,
      lastError,
    );

    return new Promise<void>((resolve) => setTimeout(resolve, delay)).then(() => {
      // Cache-busted retry — creates a fresh import() with a unique URL.
      return retryLoadDeferDependencies(loadDependencies, index, attempt).catch((retryErr) =>
        this.retryDep(loadDependencies, index, attempt + 1, retryErr),
      );
    });
  }
}

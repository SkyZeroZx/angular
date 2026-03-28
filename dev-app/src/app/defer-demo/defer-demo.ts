import {Component, signal} from '@angular/core';
import {HeavyComponent} from './heavy';

@Component({
  selector: 'app-defer-demo',
  standalone: true,
  imports: [HeavyComponent],
  template: `
    <div style="max-width: 600px; margin: 24px auto; font-family: sans-serif;">
      <h2>DeferBlockLoadingInterceptor Demo</h2>

      <p style="color: #555; line-height: 1.5;">
        This page uses a defer block to lazily load
        HeavyComponent. A RetryDeferLoadingInterceptor is registered
        via provideDeferBlockLoadingInterceptor() and retries
        failed dependency loads up to 3 times with a 1s delay.
      </p>

      <p style="color: #555; line-height: 1.5;">
        Open your browser DevTools Console to see retry
        log messages if any import fails transiently.
      </p>

      <button (click)="show.set(true)" [disabled]="show()"
              style="padding: 8px 16px; font-size: 14px; cursor: pointer;">
        Load deferred component
      </button>

      @defer (when show()) {
        <app-heavy />
      } @placeholder {
        <div style="padding: 12px; background: #f5f5f5; border-radius: 8px; margin-top: 8px; color: #999;">
          Placeholder - click the button above to trigger loading.
        </div>
      } @loading  {
        <div style="padding: 12px; background: #fff3e0; border-radius: 8px; margin-top: 8px;">
          Loading dependencies...
        </div>
      } @error {
        <div style="padding: 12px; background: #ffebee; border-radius: 8px; margin-top: 8px; color: #c62828;">
          Failed to load after all retries. Check console for details.
        </div>
      }
    </div>
  `,
})
export default class DeferDemoComponent {
  show = signal(false);
}

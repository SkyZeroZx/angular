import {
  Component,
  DestroyRef,
  ErrorHandler,
  ErrorDetails,
  Injectable,
  OnDestroy,
  effect,
  inject,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import {bootstrapApplication} from '@angular/platform-browser';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {Subject} from 'rxjs';

type ErrorRecord = {
  message: string;
  declarationType: string | null;
  declarationInstanceType: string | null;
  boundaryType: string | null;
};

type LeakSnapshot = {
  created: number;
  destroyRefCallbacks: number;
  ngOnDestroyCalls: number;
  effectRuns: number;
  busHits: number;
  brokenAttempts: number;
  allowBroken: boolean;
};

type ProbeResult = {
  ready: boolean;
  angularVersion: string | null;
  errors: ErrorRecord[];
  metadata: {
    createPass: ErrorRecord | null;
    updatePass: ErrorRecord | null;
  };
  leak: {
    snapshots: Array<{label: string; state: LeakSnapshot}>;
  };
};

declare global {
  interface Window {
    __boundaryProbe: ProbeResult;
  }
}

const probe: ProbeResult = (window.__boundaryProbe = {
  ready: false,
  angularVersion: null,
  errors: [],
  metadata: {createPass: null, updatePass: null},
  leak: {snapshots: []},
});

@Injectable({providedIn: 'root'})
class ProbeState {
  readonly allowBroken = signal(false);
  readonly reactiveTick = signal(0);
  readonly bus = new Subject<void>();

  created = 0;
  destroyRefCallbacks = 0;
  ngOnDestroyCalls = 0;
  effectRuns = 0;
  busHits = 0;
  brokenAttempts = 0;

  snapshot(): LeakSnapshot {
    return {
      created: this.created,
      destroyRefCallbacks: this.destroyRefCallbacks,
      ngOnDestroyCalls: this.ngOnDestroyCalls,
      effectRuns: this.effectRuns,
      busHits: this.busHits,
      brokenAttempts: this.brokenAttempts,
      allowBroken: this.allowBroken(),
    };
  }

  record(label: string): void {
    probe.leak.snapshots.push({label, state: this.snapshot()});
  }
}

@Injectable()
class ProbeErrorHandler extends ErrorHandler {
  override handleError(error: unknown): void {
    // Keep the probe running while retaining unexpected errors in the browser console.
    console.error('PROBE_ERROR', error);
  }

  override onViewError(error: Error, details: ErrorDetails): void {
    const record: ErrorRecord = {
      message: error.message,
      declarationType: details.declarationType?.name ?? null,
      declarationInstanceType:
        (details.declarationInstance as {constructor?: {name?: string}} | null)?.constructor?.name ??
        null,
      boundaryType: details.boundary?.type?.name ?? null,
    };
    probe.errors.push(record);
    if (error.message === 'create-pass-child-error') {
      probe.metadata.createPass = record;
    }
    if (error.message === 'update-pass-child-error') {
      probe.metadata.updatePass = record;
    }
  }
}

@Component({
  selector: 'create-throw-child',
  template: 'never rendered',
})
class CreateThrowChild {
  constructor() {
    throw new Error('create-pass-child-error');
  }
}

@Component({
  selector: 'metadata-create-host',
  imports: [CreateThrowChild],
  template: `
    @boundary {
      <create-throw-child />
    } @error {
      <span id="create-fallback">create fallback</span>
    }
  `,
})
class MetadataCreateHost {}

@Component({
  selector: 'update-throw-child',
  template: `{{ read() }}`,
})
class UpdateThrowChild {
  readonly shouldThrow = signal(false);

  read(): string {
    if (this.shouldThrow()) {
      throw new Error('update-pass-child-error');
    }
    return 'update child ok';
  }
}

@Component({
  selector: 'metadata-update-host',
  imports: [UpdateThrowChild],
  template: `
    @boundary {
      <update-throw-child #child />
      <button id="trigger-update-error" (click)="child.shouldThrow.set(true)">trigger update error</button>
    } @error {
      <span id="update-fallback">update fallback</span>
    }
  `,
})
class MetadataUpdateHost {}

@Component({
  selector: 'live-widget',
  template: `<span class="live-widget">live</span>`,
})
class LiveWidget implements OnDestroy {
  private readonly state = inject(ProbeState);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.state.created++;
    this.destroyRef.onDestroy(() => this.state.destroyRefCallbacks++);

    effect(() => {
      this.state.reactiveTick();
      this.state.effectRuns++;
    });

    this.state.bus
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.state.busHits++);
  }

  ngOnDestroy(): void {
    this.state.ngOnDestroyCalls++;
  }
}

@Component({
  selector: 'broken-widget',
  template: `<span class="broken-widget">broken-control-now-successful</span>`,
})
class BrokenWidget {
  constructor() {
    const state = inject(ProbeState);
    state.brokenAttempts++;
    if (!state.allowBroken()) {
      throw new Error('broken-widget-create-error');
    }
  }
}

@Component({
  selector: 'leak-host',
  imports: [LiveWidget, BrokenWidget],
  template: `
    <button id="allow-success" (click)="allowSuccess()">allow success</button>
    <button id="emit-bus" (click)="emitBus()">emit bus</button>
    <button id="tick-effects" (click)="tickEffects()">tick effects</button>

    @boundary {
      <live-widget />
      <broken-widget />
      <span id="leak-primary">primary</span>
    } @error {
      <span id="leak-fallback">fallback</span>
      <button id="retry-leak" (click)="$reset()">retry</button>
    }
  `,
})
class LeakHost {
  private readonly state = inject(ProbeState);

  allowSuccess(): void {
    this.state.allowBroken.set(true);
    this.state.record('allow-success');
  }

  emitBus(): void {
    this.state.bus.next();
    this.state.record('emit-bus');
  }

  tickEffects(): void {
    this.state.reactiveTick.update((v) => v + 1);
    queueMicrotask(() => this.state.record('tick-effects'));
  }
}

@Component({
  selector: 'app-root',
  imports: [MetadataCreateHost, MetadataUpdateHost, LeakHost],
  template: `
    <metadata-create-host />
    <metadata-update-host />
    <leak-host />
  `,
})
class AppRoot {
  private readonly state = inject(ProbeState);

  constructor() {
    queueMicrotask(() => this.state.record('bootstrap-microtask'));
  }
}

bootstrapApplication(AppRoot, {
  providers: [
    provideZonelessChangeDetection(),
    {provide: ErrorHandler, useClass: ProbeErrorHandler},
  ],
})
  .then(() => {
    const root = document.querySelector('app-root');
    probe.angularVersion = root?.getAttribute('ng-version') ?? null;
    probe.ready = true;
    injectProbeHelpers();
  })
  .catch((error) => {
    console.error('BOOTSTRAP_FAILED', error);
    throw error;
  });

function injectProbeHelpers(): void {
  // The E2E uses DOM events exactly as an application user would. This marker only signals that
  // bootstrap and the first boundary transitions completed.
  document.body.dataset.boundaryProbeReady = 'true';
}

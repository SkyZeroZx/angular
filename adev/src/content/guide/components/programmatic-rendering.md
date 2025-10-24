# Programmatically rendering components

TIP: This guide assumes you've already read the [Essentials Guide](essentials). Read that first if you're new to Angular.

In addition to using a component directly in a template, you can also dynamically render components
programmatically. This is helpful for situations when a component is unknown initially (thus can not
be referenced in a template directly) and it depends on some conditions.

There are two main ways to render a component programmatically: in a template using `NgComponentOutlet`,
or in your TypeScript code using `ViewContainerRef`.

HELPFUL: for lazy-loading use-cases (for example if you want to delay loading of a heavy component), consider
using the built-in [`@defer` feature](/guide/templates/defer) instead. The `@defer` feature allows the code
of any components, directives, and pipes inside the `@defer` block to be extracted into separate JavaScript
chunks automatically and loaded only when necessary, based on the configured triggers.

## Using NgComponentOutlet

`NgComponentOutlet` is a structural directive that dynamically renders a given component in a
template.

```angular-ts
@Component({ ... })
export class AdminBio { /* ... */ }

@Component({ ... })
export class StandardBio { /* ... */ }

@Component({
  ...,
  template: `
    <p>Profile for {{user.name}}</p>
    <ng-container *ngComponentOutlet="getBioComponent()" /> `
})
export class CustomDialog {
  user = input.required<User>();

  getBioComponent() {
    return this.user().isAdmin ? AdminBio : StandardBio;
  }
}
```

### Passing data to dynamically created components

`NgComponentOutlet` provides bindings for configuring the component it renders. The directive accepts the following inputs:

- `ngComponentOutlet` — Component type to instantiate.
- `ngComponentOutletInputs` — Object whose keys map to the component's inputs.
- `ngComponentOutletInjector` — Custom injector for the component.
- `ngComponentOutletContent` — Projected nodes to insert into the component.
- `ngComponentOutletEnvironmentInjector` — Custom environment injector.

These bindings update whenever their values change, keeping the rendered component in sync. The directive exposes a `componentInstance` property that you can access through a template reference variable.

```angular-ts
const WIDGET_CONFIG = new InjectionToken<WidgetConfig>('WIDGET_CONFIG');

interface WidgetConfig {
  theme: 'compact' | 'cozy';
}

@Component({
  selector: 'dynamic-widget',
  standalone: true,
  template: `
    <article>
      <h2>{{ title }}</h2>
      <ng-content />
      <p class="widget-theme">Active theme: {{ config.theme }}</p>
    </article>
  `,
})
export class DynamicWidget {
  protected readonly config = inject(WIDGET_CONFIG)
  title = input.required<string>();

  reset() {
    this.title.set('Example title');
  }
}

@Component({
  selector: 'dynamic-widget-host',
  standalone: true,
  imports: [NgComponentOutlet],
  template: `
    <ng-container
      [ngComponentOutlet]="widgetComponent"
      [ngComponentOutletInputs]="widgetInputs()"
      [ngComponentOutletContent]="widgetContent"
      [ngComponentOutletInjector]="widgetInjector"
      #widgetOutlet="ngComponentOutlet">
    </ng-container>

    <ng-template #emptyState>
      <p>No widget selected.</p>
    </ng-template>

    <button type="button" (click)="widgetOutlet.componentInstance?.reset()">Reset widget</button>
  `,
})
export class DynamicWidgetHost implements OnInit, OnDestroy {
  private readonly injector = inject(Injector);

  widgetComponent: Type<DynamicWidget> | null = DynamicWidget;
  widgetInputs = { title: 'Example title' };
  widgetContent: Node[][] = [];
  widgetInjector = Injector.create({
    providers: [{ provide: WIDGET_CONFIG, useValue: { theme: 'compact' satisfies WidgetConfig } }],
    parent: this.injector,
  });

  @ViewChild('emptyState', { read: TemplateRef, static: true }) private emptyState?: TemplateRef<unknown>;
  private projectedView?: EmbeddedViewRef<unknown>;

  ngOnInit() {
    if (this.emptyState) {
      this.projectedView = this.emptyState.createEmbeddedView({});
      this.projectedView.detectChanges();
      this.widgetContent = [this.projectedView.rootNodes];
    }
  }

  ngOnDestroy() {
    this.projectedView?.destroy();
  }
}
```

`ngComponentOutletContent` expects a two-dimensional array of DOM nodes, with one entry per projection slot. By creating an `EmbeddedViewRef` from a template, you can reuse its `rootNodes` for projection without having to manage the DOM manually. If you prefer, you can express the same configuration with the structural directive microsyntax using `*ngComponentOutlet="…"`.

See the [NgComponentOutlet API reference](api/common/NgComponentOutlet) for more information on the
directive's capabilities.

## Using ViewContainerRef

A **view container** is a node in Angular's component tree that can contain content. Any component
or directive can inject `ViewContainerRef` to get a reference to a view container corresponding to
that component or directive's location in the DOM.

You can use the `createComponent`method on `ViewContainerRef` to dynamically create and render a
component. When you create a new component with a `ViewContainerRef`, Angular appends it into the
DOM as the next sibling of the component or directive that injected the `ViewContainerRef`.

```angular-ts
@Component({
  selector: 'leaf-content',
  template: `
    This is the leaf content
  `,
})
export class LeafContent {}

@Component({
  selector: 'outer-container',
  template: `
    <p>This is the start of the outer container</p>
    <inner-item />
    <p>This is the end of the outer container</p>
  `,
})
export class OuterContainer {}

@Component({
  selector: 'inner-item',
  template: `
    <button (click)="loadContent()">Load content</button>
  `,
})
export class InnerItem {
  private viewContainer = inject(ViewContainerRef);

  loadContent() {
    this.viewContainer.createComponent(LeafContent);
  }
}
```

In the example above, clicking the "Load content" button results in the following DOM structure

```angular-html
<outer-container>
  <p>This is the start of the outer container</p>
  <inner-item>
    <button>Load content</button>
  </inner-item>
  <leaf-content>This is the leaf content</leaf-content>
  <p>This is the end of the outer container</p>
</outer-container>
```

## Lazy-loading components

HELPFUL: if you want to lazy-load some components, you may consider using the built-in [`@defer` feature](/guide/templates/defer)
instead.

If your use-case is not covered by the `@defer` feature, you can use either `NgComponentOutlet` or
`ViewContainerRef` with a standard JavaScript [dynamic import](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Operators/import).

```angular-ts
@Component({
  ...,
  template: `
    <section>
      <h2>Basic settings</h2>
      <basic-settings />
    </section>
    <section>
      <h2>Advanced settings</h2>
      @if(!advancedSettings) {
        <button (click)="loadAdvanced()">
          Load advanced settings
        </button>
      }
      <ng-container *ngComponentOutlet="advancedSettings" />
    </section>
  `
})
export class AdminSettings {
  advancedSettings: {new(): AdvancedSettings} | undefined;

  async loadAdvanced() {
    const { AdvancedSettings } = await import('path/to/advanced_settings.js');
    this.advancedSettings = AdvancedSettings;
  }
}
```

The example above loads and displays the `AdvancedSettings` upon receiving a button click.

## Binding inputs, outputs and setting host directives at creation

When dynamically creating components, manually setting inputs and subscribing to outputs can be error-prone. You often need to write extra code just to wire up bindings after the component is instantiated.

To simplify this, both `createComponent` and `ViewContainerRef.createComponent` support passing a `bindings` array with helpers like `inputBinding()`, `outputBinding()`, and `twoWayBinding()` to configure inputs and outputs up front. You can also specify a `directives` array to apply any host directives. This enables creating components programmatically with template-like bindings in a single, declarative call.

### Host view using `ViewContainerRef.createComponent`

`ViewContainerRef.createComponent` creates a component and automatically inserts its host view and host element into the container’s view hierarchy at the container’s location. Use this when the dynamic component should become part of the container’s logical and visual structure (for example, adding list items or inline UI).

By contrast, the standalone `createComponent` API does not attach the new component to any existing view or DOM location — it returns a `ComponentRef` and gives you explicit control over where to place the component’s host element.

```angular-ts
import { Component, input, model, output } from "@angular/core";

@Component({
  selector: 'app-warning',
  template: `
      @if(isExpanded()) {
        <section>
            <p>Warning: Action needed!</p>
            <button (click)="close.emit(true)">Close</button>
        </section>
      }
  `
})
export class AppWarningComponent {
  readonly canClose = input.required<boolean>();
  readonly isExpanded = model<boolean>();
  readonly close = output<boolean>();
}
```

```ts
import { Component, ViewContainerRef, signal, inputBinding, outputBinding, twoWayBinding, inject } from '@angular/core';
import { FocusTrap } from "@angular/cdk/a11y";
import { ThemeDirective } from '../theme.directive';

@Component({
  template: `<ng-container #container />`
})
export class HostComponent {
  private vcr = inject(ViewContainerRef);
  readonly canClose = signal(true);
  readonly isExpanded = signal(true);

  showWarning() {
    const compRef = this.vcr.createComponent(AppWarningComponent, {
      bindings: [
        inputBinding('canClose', this.canClose),
        twoWayBinding('isExpanded', this.isExpanded),
        outputBinding<boolean>('close', (confirmed) => {
          console.log('Closed with result:', confirmed);
        })
      ],
      directives: [
        FocusTrap,
        { type: ThemeDirective, bindings: [inputBinding('theme', () => 'warning')] }
      ]
    });
  }
}
```

In the example above, the dynamic **AppWarningComponent** is created with its `canClose` input bound to a reactive signal, a two-way binding on its `isExpanded` state, and an output listener for `close`. The `FocusTrap` and `ThemeDirective` are attached to the host element via `directives`.

### Popup attached to `document.body` with `createComponent` + `hostElement`

Use this when rendering outside the current view hierarchy (e.g., overlays). The provided `hostElement` becomes the component’s host in the DOM, so Angular doesn’t create a new element matching the selector. Lets you configure **bindings** directly.

```ts
import {
  ApplicationRef,
  createComponent,
  EnvironmentInjector,
  inject,
  Injectable,
  inputBinding,
  outputBinding,
} from '@angular/core';
import { PopupComponent } from './popup.component';

@Injectable({ providedIn: 'root' })
export class PopupService {
  private readonly injector = inject(EnvironmentInjector);
  private readonly appRef = inject(ApplicationRef);

  show(message: string) {
    // Create a host element for the popup
    const host = document.createElement('popup-host');

    // Create the component and bind in one call
    const ref = createComponent(PopupComponent, {
      environmentInjector: this.injector,
      hostElement: host,
      bindings: [
        inputBinding('message', () => message),
        outputBinding('closed', () => {
          document.body.removeChild(host);
          this.appRef.detachView(ref.hostView);
          ref.destroy();
        }),
      ],
    });

    // Registers the component’s view so it participates in change detection cycle.
    this.appRef.attachView(ref.hostView);
    // Inserts the provided host element into the DOM (outside the normal Angular view hierarchy).
    // This is what makes the popup visible on screen, typically used for overlays or modals.
    document.body.appendChild(host);
  }
}
```

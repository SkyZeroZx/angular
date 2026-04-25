/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */
import {Component, signal} from '../../src/core';
import {DeferBlockBehavior, DeferBlockState, TestBed} from '../../testing';

import {getControlFlowBlocks} from '../../src/render3/util/control_flow';
import {
  ControlFlowBlockType,
  DeferBlockData,
  ForLoopBlockData,
  IfBlockData,
} from '../../src/render3/util/control_flow_types';

describe('getControlFlowBlocks', () => {
  TestBed.configureTestingModule({
    deferBlockBehavior: DeferBlockBehavior.Manual,
  });

  it('should get all control flow blocks', () => {
    @Component({
      template: `
        <section>
          @defer (when false) {
            Loaded
          }
          @for (item of list; track $index) {
            <p>{{ item }}</p>
          }
        </section>
      `,
    })
    class App {
      list = [1, 2, 3];
    }

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const results = getControlFlowBlocks(fixture.nativeElement);
    expect(results.length).toBe(2);
    expect(results.map((block) => block.type)).toEqual([
      ControlFlowBlockType.Defer,
      ControlFlowBlockType.For,
    ]);
  });
});

describe('getControlFlowBlocks > @defer blocks', () => {
  // Use to narrow down type to `DeferBlockData` for `@defer`-specific tests.
  function getDeferBlocks(node: Node): DeferBlockData[] {
    return getControlFlowBlocks(node).filter(
      (b): b is DeferBlockData => b.type === ControlFlowBlockType.Defer,
    );
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      deferBlockBehavior: DeferBlockBehavior.Manual,
    });
  });

  it('should get current state of a defer block', async () => {
    @Component({
      template: `
        <section>
          @defer (when false) {
            Loaded
          } @placeholder {
            Placeholder
          } @loading {
            Loading
          }
        </section>
      `,
    })
    class App {}

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const [block] = await fixture.getDeferBlocks();

    expect(getDeferBlocks(fixture.nativeElement)[0].type).toBe(ControlFlowBlockType.Defer);

    await block.render(DeferBlockState.Placeholder);
    expect(getDeferBlocks(fixture.nativeElement)[0].state).toBe('placeholder');

    await block.render(DeferBlockState.Loading);
    expect(getDeferBlocks(fixture.nativeElement)[0].state).toBe('loading');

    await block.render(DeferBlockState.Complete);
    expect(getDeferBlocks(fixture.nativeElement)[0].state).toBe('complete');
  });

  it('should expose which blocks are connected to the defer block', () => {
    @Component({
      template: `
        @defer (when false) {
          No connected
        }

        @defer (when false) {
          Has loading
        } @loading (minimum 2s; after 1s) {
          Loading
        }

        @defer (when false) {
          Has all
        } @placeholder (minimum 500) {
          Placeholder
        } @loading {
          Loading
        } @error {
          Error
        }
      `,
    })
    class App {}

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const blocks = getDeferBlocks(fixture.nativeElement);
    expect(blocks.length).toBe(3);
    expect(blocks[0].type).toEqual(ControlFlowBlockType.Defer);
    expect(blocks[0]).toEqual(
      jasmine.objectContaining({
        loadingBlock: {exists: false, minimumTime: null, afterTime: null},
        placeholderBlock: {exists: false, minimumTime: null},
        hasErrorBlock: false,
      }),
    );
    expect(blocks[1].type).toEqual(ControlFlowBlockType.Defer);
    expect(blocks[1]).toEqual(
      jasmine.objectContaining({
        loadingBlock: {exists: true, minimumTime: 2000, afterTime: 1000},
        placeholderBlock: {exists: false, minimumTime: null},
        hasErrorBlock: false,
      }),
    );
    expect(blocks[2].type).toEqual(ControlFlowBlockType.Defer);
    expect(blocks[2]).toEqual(
      jasmine.objectContaining({
        loadingBlock: {exists: true, minimumTime: null, afterTime: null},
        placeholderBlock: {exists: true, minimumTime: 500},
        hasErrorBlock: true,
      }),
    );
  });

  it('should expose the triggers that were registered on the defer block', async () => {
    @Component({
      template: `
        <section>
          @defer (when false; on timer(500); on interaction) {
            Loaded
          } @placeholder {
            <button>Load</button>
          }
        </section>
      `,
    })
    class App {}

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const blocks = getDeferBlocks(fixture.nativeElement);
    expect(blocks.length).toBe(1);
    expect(blocks[0].type).toBe(ControlFlowBlockType.Defer);
    expect(blocks[0].triggers).toEqual(['on interaction', 'on timer(500ms)', 'when <expression>']);
  });

  it('should return deferred blocks only under the specified DOM node', async () => {
    @Component({
      template: `
        <section>
          <div>
            <header>
              @defer (when false) {
                Loaded
              } @placeholder {
                Placeholder
              }
            </header>
          </div>

          @defer (when false) {
            Loaded
          } @placeholder {
            Placeholder
          }
        </section>

        <button>Hello</button>
      `,
    })
    class App {}

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const blocks = await fixture.getDeferBlocks();

    // Render out one of the blocks so we can distinguish them.
    await blocks[1].render(DeferBlockState.Complete);

    const section = fixture.nativeElement.querySelector('section');
    const header = section.querySelector('header');
    const button = fixture.nativeElement.querySelector('button');

    expect(getDeferBlocks(section)).toEqual([
      jasmine.objectContaining({type: ControlFlowBlockType.Defer, state: 'placeholder'}),
      jasmine.objectContaining({type: ControlFlowBlockType.Defer, state: 'complete'}),
    ]);
    expect(getDeferBlocks(header)).toEqual([
      jasmine.objectContaining({type: ControlFlowBlockType.Defer, state: 'placeholder'}),
    ]);
    expect(getDeferBlocks(button)).toEqual([]);
  });

  it('should be able to resolve defer blocks inside embedded views', () => {
    @Component({
      template: `
        <section>
          @if (true) {
            <div>
              @switch (1) {
                @case (1) {
                  @if (true) {
                    @defer (when false) {
                      Loaded
                    } @placeholder {
                      Placeholder
                    }
                  }
                }
              }
            </div>
          }
        </section>
      `,
    })
    class App {}

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(getDeferBlocks(fixture.nativeElement)).toEqual([
      jasmine.objectContaining({type: ControlFlowBlockType.Defer, state: 'placeholder'}),
    ]);
  });

  it('should be able to resolve a defer block nested inside of another defer block', async () => {
    @Component({
      template: `
        <section>
          @defer (when false) {
            Loaded root

            @defer (when false) {
              Loaded inner
            } @placeholder {
              Placeholder inner
            }
          } @placeholder {
            Placeholder root
          }
        </section>
      `,
    })
    class App {}

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const [root] = await fixture.getDeferBlocks();

    expect(getDeferBlocks(fixture.nativeElement)).toEqual([
      jasmine.objectContaining({type: ControlFlowBlockType.Defer, state: 'placeholder'}),
    ]);

    await root.render(DeferBlockState.Complete);
    fixture.detectChanges();

    expect(getDeferBlocks(fixture.nativeElement)).toEqual([
      jasmine.objectContaining({type: ControlFlowBlockType.Defer, state: 'complete'}),
      jasmine.objectContaining({type: ControlFlowBlockType.Defer, state: 'placeholder'}),
    ]);
  });

  it('should return the root nodes of the currently-rendered block', async () => {
    @Component({
      template: `
        Before
        @defer (when false) {
          <button>One</button>
          Loaded
          <span>Two</span>
        } @placeholder {
          Placeholder text
        }
        After
      `,
    })
    class App {}

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    let results = getDeferBlocks(fixture.nativeElement);
    expect(results.length).toBe(1);
    expect(results[0].state).toBe('placeholder');
    expect(results[0].type).toBe(ControlFlowBlockType.Defer);
    expect(stringifyNodes(results[0].rootNodes)).toEqual(['Text(Placeholder text)']);

    const [block] = await fixture.getDeferBlocks();
    await block.render(DeferBlockState.Complete);

    results = getDeferBlocks(fixture.nativeElement);
    expect(results.length).toBe(1);
    expect(results[0].state).toBe('complete');
    expect(results[0].type).toBe(ControlFlowBlockType.Defer);
    expect(stringifyNodes(results[0].rootNodes)).toEqual([
      'Element(button, One)',
      'Text(Loaded)',
      'Element(span, Two)',
    ]);
  });

  it('should skip over TNodes that do not correspond to DOM nodes', async () => {
    @Component({
      template: `
        Before
        @defer (when false) {
          Loaded
        } @placeholder {
          @let one = 1;
          One is {{ one }}
          @let two = one + 1;
          Two is {{ two }}
        }
        After
      `,
    })
    class App {}

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    let results = getDeferBlocks(fixture.nativeElement);
    expect(results.length).toBe(1);
    expect(results[0].state).toBe('placeholder');
    expect(results[0].type).toBe(ControlFlowBlockType.Defer);
    expect(stringifyNodes(results[0].rootNodes)).toEqual(['Text(One is 1)', 'Text(Two is 2)']);

    const [block] = await fixture.getDeferBlocks();
    await block.render(DeferBlockState.Complete);
  });

  it('should return the host comment node of the currently-rendered block', () => {
    @Component({
      template: `
        @defer (when false) {
          Loaded
        }
      `,
    })
    class App {}

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const results = getDeferBlocks(fixture.nativeElement);

    expect(results.length).toBe(1);
    expect(results[0].type).toBe(ControlFlowBlockType.Defer);
    expect(results[0].hostNode).toBeTruthy();
    expect(stringifyNodes([results[0].hostNode])).toEqual(['Comment(container)']);
  });

  function stringifyNodes(nodes: Node[]): string[] {
    return nodes.map((node) => {
      switch (node.nodeType) {
        case document.COMMENT_NODE:
          return `Comment(${node.textContent?.trim()})`;
        case document.ELEMENT_NODE:
          return `Element(${node.nodeName.toLowerCase()}, ${node.textContent?.trim()})`;
        case document.TEXT_NODE:
          return `Text(${node.textContent?.trim()})`;
        default:
          throw new Error('Unsupported node. Function may need to be updated.');
      }
    });
  }
});

describe('getControlFlowBlocks > @for blocks', () => {
  // Use to narrow down type to `ForLoopBlockData` for `@for`-specific tests.
  function getForLoopBlocks(node: Node): ForLoopBlockData[] {
    return getControlFlowBlocks(node).filter(
      (b): b is ForLoopBlockData => b.type === ControlFlowBlockType.For,
    );
  }

  it('should get a @for block', async () => {
    @Component({
      template: `
        <section>
          @for (item of list; track $index) {
            <p>{{ item }}</p>
          }
        </section>
      `,
    })
    class App {
      list = [1, 2, 3];
    }

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const results = getForLoopBlocks(fixture.nativeElement);

    expect(results.length).toEqual(1);
    const forLoop = results[0];
    expect(forLoop).toEqual(
      jasmine.objectContaining({
        type: ControlFlowBlockType.For,
        trackExpression: '$index',
        hasEmptyBlock: false,
      } satisfies Partial<ForLoopBlockData>),
    );
    expect(forLoop.items.length).toBe(3);
    expect(forLoop.hostNode).toBeTruthy();
  });

  it('should get a @for block with an item track expression', async () => {
    @Component({
      template: `
        <section>
          @for (item of list; track item) {
            <p>{{ item }}</p>
          }
        </section>
      `,
    })
    class App {
      list = [1, 2, 3];
    }

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const results = getForLoopBlocks(fixture.nativeElement);

    expect(results.length).toBe(1);
    const forLoop = results[0];

    expect(forLoop.type).toBe(ControlFlowBlockType.For);
    expect(forLoop.trackExpression).toBe('item');
  });

  it('should get a @for block with a track by function', () => {
    @Component({
      template: `
        <section>
          @for (item of list; track trackFn()) {
            <p>{{ item }}</p>
          }
        </section>
      `,
    })
    class App {
      list = [1, 2, 3];
      trackFn = () => Math.random();
    }

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const results = getForLoopBlocks(fixture.nativeElement);

    expect(results.length).toBe(1);
    const forLoop = results[0];

    expect(forLoop.type).toBe(ControlFlowBlockType.For);
    expect(forLoop.trackExpression).toBe('function');
  });

  it('should get a @for block an @empty block', () => {
    @Component({
      template: `
        <section>
          @for (item of list; track $index) {
            <p>{{ item }}</p>
          } @empty {
            <p>No items</p>
          }
        </section>
      `,
    })
    class App {
      list = [1, 2, 3];
    }

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const results = getForLoopBlocks(fixture.nativeElement);

    expect(results.length).toBe(1);
    const forLoop = results[0];

    expect(forLoop.type).toBe(ControlFlowBlockType.For);
    expect(forLoop.hasEmptyBlock).toBe(true);
  });

  it('should get all @for blocks', () => {
    @Component({
      template: `
        <section>
          @for (item of listOne; track $index) {
            <p>{{ item }}</p>
          }
          <div>
            @for (item of listTwo; track $index) {
              <p>{{ item }}</p>
            }
            <div>
              @for (item of listThree; track $index) {
                <p>{{ item }}</p>
              }
            </div>
          </div>
        </section>
      `,
    })
    class App {
      listOne = [1, 2, 3];
      listTwo = [1, 2];
      listThree = [1];
    }

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const results = getForLoopBlocks(fixture.nativeElement);

    expect(results.length).toBe(3);
    expect(results.map((b) => [b.type, b.items.length])).toEqual([
      [ControlFlowBlockType.For, 3],
      [ControlFlowBlockType.For, 2],
      [ControlFlowBlockType.For, 1],
    ]);
  });

  it('should get all @for blocks, including nested ones', () => {
    @Component({
      template: `
        <section>
          @for (item of listOne; track $index) {
            <p>{{ item }}</p>
            @for (item of listTwo; track $index) {
              <p>{{ item }}</p>
            }
          }
          <div>
            @for (item of listThree; track $index) {
              <p>{{ item }}</p>
            }
          </div>
        </section>
      `,
    })
    class App {
      listOne = [1, 2];
      listTwo = [1, 2, 3];
      listThree = [1];
    }

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const results = getForLoopBlocks(fixture.nativeElement);

    expect(results.length).toBe(4);
    expect(results.map((b) => [b.type, b.items.length])).toEqual([
      [ControlFlowBlockType.For, 2],
      [ControlFlowBlockType.For, 3],
      [ControlFlowBlockType.For, 3],
      [ControlFlowBlockType.For, 1],
    ]);
  });
});

describe('getControlFlowBlocks > @if blocks', () => {
  // Use to narrow down type to `IfBlockData` for `@if`-specific tests.
  function getIfBlocks(node: Node): IfBlockData[] {
    return getControlFlowBlocks(node).filter(
      (b): b is IfBlockData => b.type === ControlFlowBlockType.If,
    );
  }

  it('should get a single-branch @if block in its rendered state', () => {
    @Component({
      template: `
        <section>
          @if (show) {
            <p>Hello</p>
          }
        </section>
      `,
    })
    class App {
      show = true;
    }

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const results = getIfBlocks(fixture.nativeElement);
    expect(results.length).toBe(1);
    const ifBlock = results[0];
    expect(ifBlock.type).toBe(ControlFlowBlockType.If);
    expect(ifBlock.branches.length).toBe(1);
    expect(ifBlock.activeBranchIndex).toBe(0);
    expect(ifBlock.branches[0].isActive).toBe(true);
    expect(ifBlock.hostNode).toBeTruthy();
  });

  it('should report activeBranchIndex of -1 for a falsy single-branch @if', () => {
    @Component({
      template: `
        <section>
          @if (show) {
            <p>Hello</p>
          }
        </section>
      `,
    })
    class App {
      show = false;
    }

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const [ifBlock] = getIfBlocks(fixture.nativeElement);
    expect(ifBlock.branches.length).toBe(1);
    expect(ifBlock.activeBranchIndex).toBe(-1);
    expect(ifBlock.branches[0].isActive).toBe(false);
    expect(ifBlock.branches[0].rootNodes).toEqual([]);
  });

  it('should report the active branch for an @if / @else chain', () => {
    @Component({
      template: `
        <section>
          @if (show) {
            <p>Yes</p>
          } @else {
            <p>No</p>
          }
        </section>
      `,
    })
    class App {
      show = false;
    }

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const [ifBlock] = getIfBlocks(fixture.nativeElement);
    expect(ifBlock.branches.length).toBe(2);
    expect(ifBlock.activeBranchIndex).toBe(1);
    expect(ifBlock.branches.map((b) => b.isActive)).toEqual([false, true]);
  });

  it('should track the active branch across @if / @else if / @else', async () => {
    @Component({
      template: `
        <section>
          @if (value() === 'a') {
            <p>A</p>
          } @else if (value() === 'b') {
            <p>B</p>
          } @else if (value() === 'c') {
            <p>C</p>
          } @else {
            <p>other</p>
          }
        </section>
      `,
    })
    class App {
      value = signal<string>('b');
    }

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    let [ifBlock] = getIfBlocks(fixture.nativeElement);
    expect(ifBlock.branches.length).toBe(4);
    expect(ifBlock.activeBranchIndex).toBe(1);

    fixture.componentInstance.value.set('d');
    await fixture.whenStable();

    [ifBlock] = getIfBlocks(fixture.nativeElement);
    expect(ifBlock.activeBranchIndex).toBe(3);

    fixture.componentInstance.value.set('a');
    await fixture.whenStable();

    [ifBlock] = getIfBlocks(fixture.nativeElement);
    expect(ifBlock.activeBranchIndex).toBe(0);
  });

  it('should expose root nodes for the active branch only', () => {
    @Component({
      template: `
        <section>
          @if (show) {
            <p>Yes</p>
          } @else {
            <p>No</p>
          }
        </section>
      `,
    })
    class App {
      show = true;
    }

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const [ifBlock] = getIfBlocks(fixture.nativeElement);
    expect(ifBlock.branches[0].rootNodes.length).toBeGreaterThan(0);
    expect(ifBlock.branches[1].rootNodes).toEqual([]);
  });

  it('should discover nested @if blocks', () => {
    @Component({
      template: `
        <section>
          @if (outer) {
            <p>outer</p>
            @if (inner) {
              <p>inner</p>
            }
          }
        </section>
      `,
    })
    class App {
      outer = true;
      inner = true;
    }

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const results = getIfBlocks(fixture.nativeElement);
    expect(results.length).toBe(2);
    expect(results.map((b) => b.activeBranchIndex)).toEqual([0, 0]);
  });

  it('should discover @if blocks nested inside a @for block', () => {
    @Component({
      template: `
        <section>
          @for (item of items; track $index) {
            @if (item % 2 === 0) {
              <p>even</p>
            } @else {
              <p>odd</p>
            }
          }
        </section>
      `,
    })
    class App {
      items = [1, 2, 3];
    }

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const results = getControlFlowBlocks(fixture.nativeElement);
    const forBlocks = results.filter((b) => b.type === ControlFlowBlockType.For);
    const ifBlocks = results.filter((b) => b.type === ControlFlowBlockType.If);
    expect(forBlocks.length).toBe(1);
    // One @if block per iteration of the @for loop.
    expect(ifBlocks.length).toBe(3);
    const activeBranches = (ifBlocks as IfBlockData[]).map((b) => b.activeBranchIndex);
    // items: 1 (odd → branch 1), 2 (even → branch 0), 3 (odd → branch 1).
    expect(activeBranches).toEqual([1, 0, 1]);
  });

  it('should not return @switch blocks (not yet supported)', () => {
    @Component({
      template: `
        <section>
          @switch (value) {
            @case ('a') {
              <p>A</p>
            }
            @case ('b') {
              <p>B</p>
            }
            @default {
              <p>other</p>
            }
          }
        </section>
      `,
    })
    class App {
      value = 'a';
    }

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const results = getControlFlowBlocks(fixture.nativeElement);
    expect(results).toEqual([]);
  });

  it('should differentiate @if from a sibling @switch', () => {
    @Component({
      template: `
        <section>
          @if (show) {
            <p>shown</p>
          }
          @switch (value) {
            @case ('a') {
              <p>A</p>
            }
            @default {
              <p>other</p>
            }
          }
        </section>
      `,
    })
    class App {
      show = true;
      value = 'a';
    }

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const results = getControlFlowBlocks(fixture.nativeElement);
    expect(results.length).toBe(1);
    expect(results[0].type).toBe(ControlFlowBlockType.If);
  });

  it('should differentiate @if from a nested @switch', async () => {
    @Component({
      template: `
        <section>
          @if (show) {
            @switch (value) {
              @case ('a') {
                <p>A</p>
              }
              @default {
                <p>other</p>
              }
            }
          }
        </section>
      `,
    })
    class App {
      show = true;
      value = 'a';
    }

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const results = getControlFlowBlocks(fixture.nativeElement);
    expect(results.length).toBe(1);
    expect(results[0].type).toBe(ControlFlowBlockType.If);
  });
});

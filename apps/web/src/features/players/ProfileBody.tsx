import { Component, createRef, type ReactNode } from 'react';

type Props = { children: ReactNode };
type Snapshot = {
  target: HTMLElement;
  body: HTMLElement;
  top: number;
  left: number;
  active: Element | null;
  pressed: boolean;
};

// Read the current target before React changes independently loaded profile sections.
export class ProfileBody extends Component<Props, Record<string, never>, Snapshot | null> {
  readonly content = createRef<HTMLDivElement>();
  private pressed: HTMLElement | null = null;
  private release = () => {
    this.pressed = null;
  };

  componentDidMount() {
    window.addEventListener('pointerup', this.release, true);
    window.addEventListener('pointercancel', this.release, true);
  }
  componentWillUnmount() {
    window.removeEventListener('pointerup', this.release, true);
    window.removeEventListener('pointercancel', this.release, true);
  }
  getSnapshotBeforeUpdate(): Snapshot | null {
    const root = this.content.current,
      body = root?.closest<HTMLElement>('.dialog-body');
    if (!root || !body) return null;
    const active = document.activeElement;
    let target =
      this.pressed ?? (active instanceof HTMLElement && root.contains(active) ? active : null);
    if (
      !target &&
      body.scrollTop > 0 &&
      active instanceof HTMLElement &&
      active.closest('.profile-dialog') === body.closest('.profile-dialog')
    ) {
      const bounds = body.getBoundingClientRect();
      const point = document.elementFromPoint?.(bounds.left + bounds.width / 2, bounds.top + 8);
      const reading = point?.closest<HTMLElement>('p,td,dt,dd,li,h2,h3,strong');
      if (reading && root.contains(reading)) target = reading;
    }
    if (!target || !target.isConnected) return null;
    const rect = target.getBoundingClientRect(),
      viewport = body.getBoundingClientRect();
    if (rect.bottom <= viewport.top || rect.top >= viewport.bottom) return null;
    return {
      target,
      body,
      top: rect.top,
      left: rect.left,
      active,
      pressed: this.pressed === target,
    };
  }
  componentDidUpdate(_props: Props, _state: Record<string, never>, snapshot: Snapshot | null) {
    if (
      !snapshot ||
      !snapshot.target.isConnected ||
      !this.content.current?.contains(snapshot.target)
    )
      return;
    if (
      snapshot.pressed
        ? this.pressed !== snapshot.target
        : document.activeElement !== snapshot.active
    )
      return;
    const rect = snapshot.target.getBoundingClientRect();
    snapshot.body.scrollTop += rect.top - snapshot.top;
    for (
      let node = snapshot.target.parentElement;
      node && snapshot.body.contains(node);
      node = node.parentElement
    ) {
      if (
        node.scrollWidth <= node.clientWidth ||
        !/auto|scroll/.test(getComputedStyle(node).overflowX)
      )
        continue;
      node.scrollLeft += snapshot.target.getBoundingClientRect().left - snapshot.left;
      break;
    }
  }
  render() {
    return (
      <div
        ref={this.content}
        className="profile-body-content"
        onPointerDownCapture={(event) => {
          if (event.button !== 0 || !(event.target instanceof Element)) return;
          this.pressed = event.target.closest<HTMLElement>(
            'button,a,input,select,textarea,[tabindex]',
          );
        }}
      >
        {this.props.children}
      </div>
    );
  }
}

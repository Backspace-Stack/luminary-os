import { Component, Suspense, createElement, lazy, useState, type Attributes, type ComponentProps, type ComponentType, type ReactNode } from 'react';

class PageErrorBoundary extends Component<
  { children: ReactNode; onRetry: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6" role="alert">
        <p style={{ color: 'var(--lum-text-secondary)', fontSize: 13 }}>This page could not load.</p>
        <button
          onClick={this.props.onRetry}
          className="rounded-lg px-4 py-2 text-sm focus-visible:outline focus-visible:outline-2"
          style={{ color: 'var(--lum-accent-bright)', background: 'rgb(var(--lum-accent-rgb) / 0.14)' }}
        >
          Try again
        </button>
      </div>
    );
  }
}

export function lazyPage<Props extends object>(load: () => Promise<{ default: ComponentType<Props> }>) {
  return function LazyPage(props: Props) {
    const [attempt, setAttempt] = useState(0);
    // React.lazy caches rejected imports. A new instance lets retry call the
    // loader again without resetting the always-mounted ChatProvider.
    const [Page, setPage] = useState(() => lazy(load));
    const retry = () => { setPage(() => lazy(load)); setAttempt(current => current + 1); };

    return (
      <PageErrorBoundary key={attempt} onRetry={retry}>
        <Suspense fallback={
          <div className="flex flex-1 items-center justify-center p-6" role="status" aria-live="polite">
            <span style={{ color: 'var(--lum-text-secondary)', fontSize: 13 }}>Loading page…</span>
          </div>
        }>
          {createElement(Page, props as ComponentProps<typeof Page> & Attributes)}
        </Suspense>
      </PageErrorBoundary>
    );
  };
}

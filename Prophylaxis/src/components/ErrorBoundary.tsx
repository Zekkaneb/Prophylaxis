import { Component, type ErrorInfo, type ReactNode } from 'react';
import './ErrorBoundary.css';

interface Props {
  children: ReactNode;
  /** The feature module this boundary guards, named in the fallback. */
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * The last line of defence: one screen's exception stops this subtree, not the
 * whole window. Without it a render error unmounts everything and leaves an
 * empty page with nothing to act on, which is indistinguishable from a hang.
 * The message is shown because it is the one piece of information that makes a
 * report actionable.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[app] render failed', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash" role="alert">
        <div className="crash__panel">
          <p className="crash__eyebrow">Something stopped</p>
          <h1 className="crash__title">
            {this.props.label
              ? `The ${this.props.label} view could not be drawn`
              : 'This screen could not be drawn'}
          </h1>
          <p className="crash__body">
            Your games, courses and reviews are still stored on this device. Reloading
            usually clears it; the message below says what went wrong.
          </p>
          <pre className="crash__error">{error.message || String(error)}</pre>
          <div className="crash__actions">
            <button
              type="button"
              className="primary-btn"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
}

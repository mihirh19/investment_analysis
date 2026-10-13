import { Component, type ReactNode } from 'react'

interface Props {
  /** Changing this (e.g. the route) clears the error so the next screen can render. */
  resetKey: string
  children: ReactNode
}

interface State {
  error: Error | null
  key: string
}

/** Keeps a crash in one screen from blanking the whole window. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('[screen error]', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="max-w-[72ch] py-10">
        <p className="wide text-[22px] font-semibold">This screen hit a problem.</p>
        <p className="mt-2 text-ink-muted">
          Your data is safe. Pick another section on the left, or reload this one. If it keeps happening, the message
          below helps find the cause.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-md border border-rule bg-sheet p-3 text-[13px] whitespace-pre-wrap">
          {this.state.error.message}
        </pre>
        <button
          onClick={() => this.setState({ error: null })}
          className="mt-4 rounded-md bg-stamp px-4 py-2 font-medium text-white dark:text-[#10162a]"
        >
          Reload this screen
        </button>
      </div>
    )
  }
}

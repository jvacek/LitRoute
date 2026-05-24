/**
 * Unit tests for the shared Turnstile hook. The form-level tests
 * (FeedbackForm / CheckinForm / Login / GuestEmailCapture) cover
 * integration; these focus on the hook's contract: `show`,
 * `isReady`, `reset`, and `externalError`/`onRetry` wiring.
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';

type TurnstileProps = {
  onSuccess?: (token: string) => void;
  onError?: () => void;
  onExpire?: () => void;
};
let lastTurnstileProps: TurnstileProps | null = null;
const mockTurnstileReset = jest.fn();
jest.mock('@marsidev/react-turnstile', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLazy = require('react');
  return {
    __esModule: true,
    Turnstile: ReactLazy.forwardRef(function MockTurnstile(
      props: TurnstileProps,
      ref: React.Ref<{ reset: () => void }>,
    ) {
      lastTurnstileProps = props;
      ReactLazy.useImperativeHandle(ref, () => ({
        reset: mockTurnstileReset,
      }));
      return null;
    }),
  };
});

let mockSiteKey = 'TEST_TURNSTILE';
jest.mock('../lib/useConfig', () => ({
  __esModule: true,
  useConfig: () => ({
    maptilerKey: 'TEST_KEY',
    turnstileSiteKey: mockSiteKey,
    allowRegistration: false,
  }),
}));

import { useTurnstileGate } from '../lib/useTurnstileGate';

interface ProbeProps {
  enabled?: boolean;
  externalError?: boolean;
  onRetry?: () => void;
}

function Probe(props: ProbeProps) {
  const { token, widget, isReady, show, reset } = useTurnstileGate(props);
  return (
    <div>
      <span data-testid="token">{token}</span>
      <span data-testid="ready">{String(isReady)}</span>
      <span data-testid="show">{String(show)}</span>
      <button type="button" onClick={reset}>
        force-reset
      </button>
      {widget}
    </div>
  );
}

describe('useTurnstileGate', () => {
  beforeEach(() => {
    mockSiteKey = 'TEST_TURNSTILE';
    lastTurnstileProps = null;
    mockTurnstileReset.mockClear();
  });

  it('is inert (show=false, isReady=true, widget=null) when disabled', () => {
    render(<Probe enabled={false} />);
    expect(screen.getByTestId('show').textContent).toBe('false');
    expect(screen.getByTestId('ready').textContent).toBe('true');
    expect(lastTurnstileProps).toBeNull();
  });

  it('is inert when the site key is unset', () => {
    mockSiteKey = '';
    render(<Probe />);
    expect(screen.getByTestId('show').textContent).toBe('false');
    expect(screen.getByTestId('ready').textContent).toBe('true');
    expect(lastTurnstileProps).toBeNull();
  });

  it('flips isReady when the widget issues a token via onSuccess', () => {
    render(<Probe />);
    expect(screen.getByTestId('ready').textContent).toBe('false');
    act(() => {
      lastTurnstileProps?.onSuccess?.('tok-1');
    });
    expect(screen.getByTestId('token').textContent).toBe('tok-1');
    expect(screen.getByTestId('ready').textContent).toBe('true');
  });

  it('reset() clears the token, surfaces the retry UI, and remounts the widget', () => {
    render(<Probe />);
    act(() => {
      lastTurnstileProps?.onSuccess?.('tok-1');
    });
    fireEvent.click(screen.getByRole('button', { name: /force-reset/i }));

    expect(screen.getByTestId('token').textContent).toBe('');
    expect(screen.getByTestId('ready').textContent).toBe('false');
    expect(mockTurnstileReset).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/couldn't verify you weren't a bot/i),
    ).toBeInTheDocument();
  });

  it('externalError surfaces the retry UI without going through onError', () => {
    function Wrapper() {
      const [ext, setExt] = useState(true);
      return (
        <>
          <Probe externalError={ext} onRetry={() => setExt(false)} />
          <button type="button" onClick={() => setExt(false)}>
            kill-ext
          </button>
        </>
      );
    }

    render(<Wrapper />);
    expect(
      screen.getByText(/couldn't verify you weren't a bot/i),
    ).toBeInTheDocument();
  });

  it('retry button fires onRetry before remounting the widget', () => {
    const onRetry = jest.fn();
    render(<Probe externalError onRetry={onRetry} />);

    fireEvent.click(
      screen.getByRole('button', { name: /try the check again/i }),
    );

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(mockTurnstileReset).toHaveBeenCalledTimes(1);
  });
});

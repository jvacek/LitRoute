/**
 * Mirrors `CheckinForm.turnstile.test.tsx` for the feedback flow. Covers the
 * extra path FeedbackForm has: detecting a server `detail` that mentions
 * "captcha" and resetting the widget in response.
 */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

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

const mockApiFetch = jest.fn();
jest.mock('../api', () => ({
  __esModule: true,
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

jest.mock('../AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({
    isAuthenticated: false,
    username: '',
    name: '',
    adminUrl: null,
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock('../lib/useConfig', () => ({
  __esModule: true,
  useConfig: () => ({
    maptilerKey: 'TEST_KEY',
    turnstileSiteKey: 'TEST_TURNSTILE',
    allowRegistration: false,
  }),
}));

import FeedbackForm from '../components/FeedbackForm';

function fillAndSubmit(message = 'Hello there') {
  fireEvent.change(screen.getByLabelText(/your message/i), {
    target: { value: message },
  });
  fireEvent.click(screen.getByRole('button', { name: /send feedback/i }));
}

describe('FeedbackForm Turnstile state', () => {
  beforeEach(() => {
    lastTurnstileProps = null;
    mockTurnstileReset.mockClear();
    mockApiFetch.mockReset();
  });

  it('shows the retry UI when the widget fires onError', () => {
    render(<FeedbackForm />);

    act(() => {
      lastTurnstileProps?.onError?.();
    });

    expect(
      screen.getByText(/couldn't verify you weren't a bot/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /try the check again/i }),
    ).toBeInTheDocument();
  });

  it('retry button calls reset() and clears the error UI', () => {
    render(<FeedbackForm />);

    act(() => {
      lastTurnstileProps?.onError?.();
    });
    fireEvent.click(
      screen.getByRole('button', { name: /try the check again/i }),
    );

    expect(mockTurnstileReset).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText(/couldn't verify you weren't a bot/i),
    ).not.toBeInTheDocument();
  });

  it('onExpire resets the widget', () => {
    render(<FeedbackForm />);

    act(() => {
      lastTurnstileProps?.onSuccess?.('first-token');
    });
    act(() => {
      lastTurnstileProps?.onExpire?.();
    });

    expect(mockTurnstileReset).toHaveBeenCalledTimes(1);
  });

  it('flips into the retry state when the server rejects with a captcha detail', async () => {
    mockApiFetch.mockResolvedValue({
      ok: false,
      json: async () => ({
        detail: 'Captcha verification failed. Please try again.',
      }),
    });
    render(<FeedbackForm />);

    act(() => {
      lastTurnstileProps?.onSuccess?.('stale-token');
    });
    fillAndSubmit();

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(/couldn't verify you weren't a bot/i),
    ).toBeInTheDocument();
    expect(mockTurnstileReset).toHaveBeenCalledTimes(1);
  });

  it('leaves the retry UI alone for non-captcha server errors', async () => {
    mockApiFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ detail: 'Something else broke.' }),
    });
    render(<FeedbackForm />);

    act(() => {
      lastTurnstileProps?.onSuccess?.('good-token');
    });
    fillAndSubmit();

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(/something else broke/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/couldn't verify you weren't a bot/i),
    ).not.toBeInTheDocument();
    expect(mockTurnstileReset).not.toHaveBeenCalled();
  });

  it('blocks submit + shows pending message when no token has been issued', () => {
    render(<FeedbackForm />);

    // Deliberately do NOT fire onSuccess — simulates the user clicking
    // submit before the silent check finishes.
    fillAndSubmit();

    expect(
      screen.getByText(/please complete the captcha before submitting/i),
    ).toBeInTheDocument();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });
});

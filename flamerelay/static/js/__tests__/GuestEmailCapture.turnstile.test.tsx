/**
 * Covers the Turnstile gate on the "thank you for checking in" guest
 * follow-up form: token included in the request body, submit blocked
 * before token, captcha-detail server error remounts the widget.
 */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

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

jest.mock('../lib/useConfig', () => ({
  __esModule: true,
  useConfig: () => ({
    maptilerKey: 'TEST_KEY',
    turnstileSiteKey: 'TEST_TURNSTILE',
    allowRegistration: false,
  }),
}));

import GuestEmailCapture from '../components/GuestEmailCapture';

function renderForm() {
  return render(
    <GuestEmailCapture
      identifier="ABC-1"
      checkinId={42}
      followerCount={0}
      onDone={jest.fn()}
    />,
  );
}

function fillAndSubmit(email = 'follower@example.com') {
  fireEvent.change(screen.getByPlaceholderText(/your@email\.com/i), {
    target: { value: email },
  });
  fireEvent.click(screen.getByRole('button', { name: /follow this lighter/i }));
}

describe('GuestEmailCapture Turnstile state', () => {
  beforeEach(() => {
    lastTurnstileProps = null;
    mockTurnstileReset.mockClear();
    mockApiFetch.mockReset();
  });

  it('blocks submit until a token has been issued', () => {
    renderForm();
    fillAndSubmit();
    expect(
      screen.getByText(/please complete the captcha before submitting/i),
    ).toBeInTheDocument();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('includes the token in the request body once issued', async () => {
    mockApiFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    renderForm();

    act(() => {
      lastTurnstileProps?.onSuccess?.('good-token');
    });
    fillAndSubmit();

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse(
      (mockApiFetch.mock.calls[0][1] as { body: string }).body,
    );
    expect(body).toEqual({
      email: 'follower@example.com',
      checkin_id: 42,
      turnstile_token: 'good-token',
    });
  });

  it('flips into the retry state when the server rejects with a captcha detail', async () => {
    mockApiFetch.mockResolvedValue({
      ok: false,
      json: async () => ({
        detail: 'Captcha verification failed. Please try again.',
      }),
    });
    renderForm();

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
});

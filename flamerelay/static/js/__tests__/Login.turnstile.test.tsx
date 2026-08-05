/**
 * Covers the Turnstile gate on the sign-in / sign-up email step: token
 * forwarded to requestLoginCode, submit blocked before token, captcha-
 * detail server error remounts the widget.
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

const mockNavigate = jest.fn();
jest.mock('react-router', () => ({
  __esModule: true,
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams(), jest.fn()],
}));

import {
  requestLoginCode,
  getSession,
  type AllauthResponse,
} from '../lib/allauthApi';

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

jest.mock('../lib/allauthApi');
jest.mock('@simplewebauthn/browser', () => ({
  __esModule: true,
  startAuthentication: jest.fn(),
  WebAuthnAbortService: { cancelCeremony: jest.fn() },
}));

jest.mock('../lib/useConfig', () => ({
  __esModule: true,
  useConfig: () => ({
    maptilerKey: 'TEST_KEY',
    turnstileSiteKey: 'TEST_TURNSTILE',
    allowRegistration: false,
  }),
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

// SocialProviders pulls in allauth/config + form-post helpers we don't
// need exercised here; render a placeholder so the email-step JSX stays
// representative.
jest.mock('../components/SocialProviders', () => ({
  __esModule: true,
  default: () => null,
}));

const mockRequestLoginCode = jest.mocked(requestLoginCode);
const mockGetSession = jest.mocked(getSession);

const UNAUTH_SESSION: AllauthResponse = {
  status: 200,
  meta: { is_authenticated: false },
  data: { flows: [] },
};

import Login from '../pages/Login';

function renderLogin() {
  return render(<Login />);
}

function fillAndSubmit(email = 'user@example.com') {
  fireEvent.change(screen.getByLabelText(/email/i), {
    target: { value: email },
  });
  fireEvent.click(screen.getByRole('button', { name: /continue with email/i }));
}

describe('Login Turnstile state', () => {
  beforeEach(() => {
    lastTurnstileProps = null;
    mockTurnstileReset.mockClear();
    mockRequestLoginCode.mockReset();
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue(UNAUTH_SESSION);
  });

  it('blocks submit until a token has been issued', async () => {
    renderLogin();
    // Wait for the email form to mount past getSession()
    await screen.findByLabelText(/email/i);

    fillAndSubmit();

    expect(
      screen.getByText(/please complete the captcha before submitting/i),
    ).toBeInTheDocument();
    expect(mockRequestLoginCode).not.toHaveBeenCalled();
  });

  it('forwards the token to requestLoginCode once issued', async () => {
    mockRequestLoginCode.mockResolvedValue({ ok: true });
    renderLogin();
    await screen.findByLabelText(/email/i);

    act(() => {
      lastTurnstileProps?.onSuccess?.('good-token');
    });
    fillAndSubmit();

    await waitFor(() => expect(mockRequestLoginCode).toHaveBeenCalledTimes(1));
    expect(mockRequestLoginCode).toHaveBeenCalledWith(
      'user@example.com',
      'good-token',
    );
  });

  it('remounts the widget when the server detail mentions captcha', async () => {
    mockRequestLoginCode.mockResolvedValue({
      ok: false,
      detail: 'Captcha verification failed. Please try again.',
    });
    renderLogin();
    await screen.findByLabelText(/email/i);

    act(() => {
      lastTurnstileProps?.onSuccess?.('stale-token');
    });
    fillAndSubmit();

    await waitFor(() => expect(mockRequestLoginCode).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockTurnstileReset).toHaveBeenCalledTimes(1));
  });
});

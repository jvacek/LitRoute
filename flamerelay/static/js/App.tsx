import { Component, Suspense, lazy, useEffect } from 'react';
import {
  Outlet,
  Route,
  RouterProvider,
  createBrowserRouter,
  createRoutesFromElements,
  useLocation,
} from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import PrivateRoute from './PrivateRoute';
import Footer from './components/Footer';
import Navbar from './components/Navbar';
import doodlesSrc from './assets/backgrounds/pattern.webp';
import About from './pages/About';
import {
  CheckinCreateErrorElement,
  checkinCreateLoader,
} from './pages/CheckinCreate.loader';
import {
  CheckinEditErrorElement,
  checkinEditLoader,
} from './pages/CheckinEdit.loader';
import ContributorGuide from './pages/ContributorGuide';
import Support from './pages/Support';
import EmailConfirm from './pages/EmailConfirm';
import ErrorPage from './pages/ErrorPage';
import Feedback from './pages/Feedback';
import { gameLeaderboardLoader } from './pages/GameLeaderboard.loader';
import Privacy from './pages/Privacy';
import Home from './pages/Home';
import { homeLoader } from './pages/Home/loader';
import { rootLoader } from './pages/root.loader';
import Signup from './pages/Signup';
import SocialConnections from './pages/SocialConnections';
import Terms from './pages/Terms';
import { UnitErrorElement, unitLoader } from './pages/Unit.loader';
import UserDetail from './pages/UserDetail';
import { userDetailLoader } from './pages/UserDetail.loader';
import UserForm from './pages/UserForm';
import { userFormLoader } from './pages/UserForm.loader';

// Home is the QR-landing front page — bundled into the entry so it paints
// without a second-roundtrip lazy chunk. `cobe` stays lazy via SpinningGlobe.
// Unit/Checkin* pull in maplibre-gl; Login/UserSettings pull in
// @simplewebauthn/browser and qrcode.
//
// `webpackChunkName` magic comments on Unit and Login give those two chunks
// stable, human-readable filenames in prod (webpack's default `chunkIds:
// "deterministic"` produces numeric IDs like `940-<hash>.js`). The preload
// hints in spa.html look these chunks up by name prefix — see
// flamerelay/utils/preload.py.
const Unit = lazy(
  () => import(/* webpackChunkName: "pages-Unit" */ './pages/Unit'),
);
const CheckinCreate = lazy(() => import('./pages/CheckinCreate'));
const CheckinEdit = lazy(() => import('./pages/CheckinEdit'));
const GameLeaderboard = lazy(() => import('./pages/GameLeaderboard'));
const Login = lazy(
  () => import(/* webpackChunkName: "pages-Login" */ './pages/Login'),
);
const UserSettings = lazy(() => import('./pages/UserSettings'));

// Capture is handled by Sentry.reactErrorHandler() wired into createRoot's
// onCaughtError; this boundary only renders the fallback UI.
class ErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return <ErrorPage code={500} />;
    return this.props.children;
  }
}

function Layout() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <div className="relative flex min-h-screen flex-col">
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-17"
        style={{
          backgroundColor: 'var(--color-amber)',
          maskImage: `url(${doodlesSrc})`,
          maskRepeat: 'repeat',
          maskPosition: '137px 94px',
          WebkitMaskImage: `url(${doodlesSrc})`,
          WebkitMaskRepeat: 'repeat',
          WebkitMaskPosition: '137px 94px',
        }}
        aria-hidden="true"
      />
      <Navbar />
      <div key={pathname} className="page-enter flex-1">
        <Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" />}>
          {/* `key={pathname}` re-mounts the boundary on every navigation so a
              caught error on one page doesn't poison subsequent routes. The
              outer ErrorBoundary still catches crashes in AuthProvider/Navbar/
              Footer; this inner one isolates page-level failures. */}
          <ErrorBoundary key={pathname}>
            <Outlet />
          </ErrorBoundary>
        </Suspense>
      </div>
      <Footer />
    </div>
  );
}

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route id="root" element={<Layout />} loader={rootLoader}>
      <Route path="/" element={<Home />} loader={homeLoader} />
      <Route path="/about/" element={<About />} />
      <Route path="/support/" element={<Support />} />
      <Route path="/contribute/" element={<ContributorGuide />} />
      <Route path="/feedback/" element={<Feedback />} />
      <Route path="/privacy/" element={<Privacy />} />
      <Route path="/terms/" element={<Terms />} />
      <Route path="/accounts/login/" element={<Login />} />
      <Route path="/accounts/signup/" element={<Signup />} />
      <Route path="/accounts/confirm-email/:key" element={<EmailConfirm />} />
      <Route
        path="/unit/:identifier/"
        element={<Unit />}
        loader={unitLoader}
        errorElement={<UnitErrorElement />}
      />
      <Route
        path="/unit/:identifier/checkin"
        element={<CheckinCreate />}
        loader={checkinCreateLoader}
        errorElement={<CheckinCreateErrorElement />}
      />
      <Route
        path="/unit/:identifier/checkin/:checkinId"
        element={<CheckinEdit />}
        loader={checkinEditLoader}
        errorElement={<CheckinEditErrorElement />}
      />
      <Route
        path="/game/:gameId/leaderboard/"
        element={<GameLeaderboard />}
        loader={gameLeaderboardLoader}
      />
      <Route
        path="/profile/"
        element={
          <PrivateRoute>
            <UserDetail />
          </PrivateRoute>
        }
        loader={userDetailLoader}
      />
      <Route
        path="/profile/update/"
        element={
          <PrivateRoute>
            <UserForm />
          </PrivateRoute>
        }
        loader={userFormLoader}
      />
      <Route
        path="/profile/settings/"
        element={
          <PrivateRoute>
            <UserSettings />
          </PrivateRoute>
        }
      />
      <Route
        path="/socialconnect/"
        element={
          <PrivateRoute>
            <SocialConnections />
          </PrivateRoute>
        }
      />
      <Route path="*" element={<ErrorPage code={404} />} />
    </Route>,
  ),
);

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ErrorBoundary>
  );
}

import { Component, useEffect } from 'react';
import {
  BrowserRouter,
  Outlet,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import PrivateRoute from './PrivateRoute';
import Footer from './components/Footer';
import Navbar from './components/Navbar';
import doodlesSrc from './assets/backgrounds/pattern.webp';
import About from './pages/About';
import ContributorGuide from './pages/ContributorGuide';
import Support from './pages/Support';
import CheckinCreate from './pages/CheckinCreate';
import CheckinEdit from './pages/CheckinEdit';
import EmailConfirm from './pages/EmailConfirm';
import ErrorPage from './pages/ErrorPage';
import Feedback from './pages/Feedback';
import GameLeaderboard from './pages/GameLeaderboard';
import Home from './pages/Home';
import Login from './pages/Login';
import Privacy from './pages/Privacy';
import Signup from './pages/Signup';
import SocialConnections from './pages/SocialConnections';
import Terms from './pages/Terms';
import Unit from './pages/Unit';
import UserDetail from './pages/UserDetail';
import UserForm from './pages/UserForm';
import UserSettings from './pages/UserSettings';

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
        <Outlet />
      </div>
      <Footer />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <AuthProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Home />} />
              <Route path="/about/" element={<About />} />
              <Route path="/support/" element={<Support />} />
              <Route path="/contribute/" element={<ContributorGuide />} />
              <Route path="/feedback/" element={<Feedback />} />
              <Route path="/privacy/" element={<Privacy />} />
              <Route path="/terms/" element={<Terms />} />
              <Route path="/accounts/login/" element={<Login />} />
              <Route path="/accounts/signup/" element={<Signup />} />
              <Route
                path="/accounts/confirm-email/:key"
                element={<EmailConfirm />}
              />
              <Route path="/unit/:identifier/" element={<Unit />} />
              <Route
                path="/unit/:identifier/checkin"
                element={<CheckinCreate />}
              />
              <Route
                path="/unit/:identifier/checkin/:checkinId"
                element={<CheckinEdit />}
              />
              <Route
                path="/game/:gameId/leaderboard/"
                element={<GameLeaderboard />}
              />
              <Route
                path="/profile/"
                element={
                  <PrivateRoute>
                    <UserDetail />
                  </PrivateRoute>
                }
              />
              <Route
                path="/profile/update/"
                element={
                  <PrivateRoute>
                    <UserForm />
                  </PrivateRoute>
                }
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
            </Route>
          </Routes>
        </AuthProvider>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

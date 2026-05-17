const { merge } = require('webpack-merge');
const { sentryWebpackPlugin } = require('@sentry/webpack-plugin');
const commonConfig = require('./common.config');

// This variable should mirror the one from config/settings/production.py
const staticUrl = '/static/';

// Only upload source maps when an auth token is present. Local prod builds
// (e.g. for testing) work without it; CI sets all three secrets.
const sentryPlugin = process.env.SENTRY_AUTH_TOKEN
  ? [
      sentryWebpackPlugin({
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
        release: { name: process.env.GIT_HASH || undefined },
        sourcemaps: { filesToDeleteAfterUpload: ['**/*.map'] },
      }),
    ]
  : [];

module.exports = merge(commonConfig, {
  mode: 'production',
  // 'hidden-source-map' emits .map files for Sentry but strips the
  // sourceMappingURL comment from JS so browsers don't try to load them.
  devtool: 'hidden-source-map',
  bail: true,
  output: {
    publicPath: `${staticUrl}webpack_bundles/`,
  },
  plugins: sentryPlugin,
});

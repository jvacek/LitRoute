const { merge } = require('webpack-merge');
const commonConfig = require('./common.config');

module.exports = merge(commonConfig, {
  mode: 'development',
  devtool: 'inline-source-map',
  watchOptions: {
    poll: false,
    ignored: [
      '**/node_modules/**',
      '**/webpack_bundles/**',
      '**/.webpack_cache/**',
      '**/webpack-stats.json',
      '**/.git/**',
      '**/__pycache__/**',
      '**/staticfiles/**',
    ],
  },
  devServer: {
    host: '0.0.0.0',
    allowedHosts: 'all',
    port: 3000,
    proxy: [
      {
        context: ['/'],
        target: 'http://django:8000',
      },
    ],
    client: {
      overlay: {
        errors: true,
        warnings: false,
        runtimeErrors: true,
      },
      // Derive the live-reload WebSocket URL from window.location so it works
      // when the dev server is reached over an https tunnel (e.g. Tailscale
      // Funnel). The 0.0.0.0/0 sentinels mean "use the page's hostname/port",
      // and `auto:` picks ws/wss based on the page protocol — without this
      // the client tries ws:// from an https:// page and Safari blocks it.
      webSocketURL: 'auto://0.0.0.0:0/ws',
    },
    // We need hot=false (Disable HMR) to set liveReload=true
    hot: false,
    liveReload: true,
  },
});

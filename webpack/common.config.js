const path = require('path');
const { execSync } = require('child_process');
const webpack = require('webpack');
const BundleTracker = require('webpack-bundle-tracker');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

const GITHUB_REPO_URL = 'https://github.com/jvacek/flamerelay';

function getGitCommit() {
  // CI / Docker build passes GIT_HASH as a build arg; .git is not in the
  // client-builder Docker context, so the git command falls back to empty there.
  if (process.env.GIT_HASH) return process.env.GIT_HASH;
  try {
    return execSync('git rev-parse HEAD').toString().trim();
  } catch {
    return '';
  }
}

const gitCommit = getGitCommit();

module.exports = {
  target: 'web',
  cache: {
    type: 'filesystem',
    cacheDirectory: path.resolve(__dirname, '../.webpack_cache'),
  },
  context: path.join(__dirname, '../'),
  entry: {
    project: path.resolve(__dirname, '../flamerelay/static/js/project'),
  },
  output: {
    path: path.resolve(__dirname, '../flamerelay/static/webpack_bundles/'),
    publicPath: '/static/webpack_bundles/',
    filename: 'js/[name]-[fullhash].js',
    chunkFilename: 'js/[name]-[hash].js',
  },
  optimization: {
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        // The shared map stack (used by Unit/Checkin/Game lazy routes) goes
        // into one long-lived chunk so a deploy that doesn't touch maps
        // doesn't bust the browser cache for it.
        maplibre: {
          test: /[\\/]node_modules[\\/](maplibre-gl|react-map-gl|@vis\.gl[\\/]react-maplibre|@maptiler)[\\/]/,
          name: 'vendor-maplibre',
          chunks: 'all',
          priority: 30,
        },
        // Sentry SDK + its internal packages (browser-utils, replay, etc.)
        // are initialized in project.tsx so they always land in the entry.
        sentry: {
          test: /[\\/]node_modules[\\/](@sentry|@sentry-internal)[\\/]/,
          name: 'vendor-sentry',
          chunks: 'initial',
          priority: 30,
        },
        react: {
          test: /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/,
          name: 'vendor-react',
          chunks: 'initial',
          priority: 30,
        },
        // i18n is bootstrapped in project.tsx → entry-only.
        i18n: {
          test: /[\\/]node_modules[\\/](i18next|react-i18next|i18next-browser-languagedetector)[\\/]/,
          name: 'vendor-i18n',
          chunks: 'initial',
          priority: 30,
        },
        // Other node_modules used by 2+ async chunks — extracted so common
        // deps load once. Single-use async deps stay in their owning chunk
        // (e.g. cobe with Home, @simplewebauthn with Login, qrcode with
        // UserSettings) so visitors only pay for what they actually use.
        asyncVendors: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors-async',
          chunks: 'async',
          minChunks: 2,
          priority: 10,
          reuseExistingChunk: true,
        },
        // Everything else from node_modules pulled into the entry path.
        vendors: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          chunks: 'initial',
          priority: 5,
          reuseExistingChunk: true,
        },
      },
    },
  },
  plugins: [
    new BundleTracker({
      path: path.resolve(path.join(__dirname, '../')),
      filename: 'webpack-stats.json',
    }),
    new MiniCssExtractPlugin({ filename: 'css/[name].[contenthash].css' }),
    new webpack.DefinePlugin({
      __GIT_COMMIT__: JSON.stringify(gitCommit),
      __GITHUB_REPO_URL__: JSON.stringify(GITHUB_REPO_URL),
      __IS_LOCAL__: JSON.stringify(process.env.IS_LOCAL === 'true'),
    }),
  ],
  module: {
    rules: [
      {
        test: /\.[jt]sx?$/,
        loader: 'babel-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.svg$/i,
        oneOf: [
          {
            // import Foo from './foo.svg?react' → React component with currentColor support
            resourceQuery: /react/,
            use: [{ loader: '@svgr/webpack', options: { svgo: false } }],
          },
          {
            type: 'asset/resource',
          },
        ],
      },
      {
        test: /\.(png|gif|jpe?g|webp)$/i,
        type: 'asset/resource',
      },
      {
        // CHANGELOG.md → pre-rendered HTML at build time. The marked dep
        // stays in devDependencies; no markdown parser ships to the browser.
        test: /CHANGELOG\.md$/,
        use: [path.resolve(__dirname, 'loaders/changelog-loader.js')],
      },
      {
        // PostCSS/Tailwind runs only on project CSS; node_modules CSS is extracted as-is below
        test: /\.css$/i,
        exclude: /node_modules/,
        use: [
          MiniCssExtractPlugin.loader,
          'css-loader',
          {
            loader: 'postcss-loader',
            options: {
              postcssOptions: {
                plugins: ['@tailwindcss/postcss'],
              },
            },
          },
        ],
      },
      {
        test: /\.css$/i,
        include: /node_modules/,
        use: [MiniCssExtractPlugin.loader, 'css-loader'],
      },
    ],
  },
  resolve: {
    modules: ['node_modules'],
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  },
};

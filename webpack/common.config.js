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
    vendors: path.resolve(__dirname, '../flamerelay/static/js/vendors'),
  },
  output: {
    path: path.resolve(__dirname, '../flamerelay/static/webpack_bundles/'),
    publicPath: '/static/webpack_bundles/',
    filename: 'js/[name]-[fullhash].js',
    chunkFilename: 'js/[name]-[hash].js',
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

import { defineConfig } from '@tarojs/cli';
import * as path from 'path';

export default defineConfig({
  projectName: 'points-mall',
  date: '2024-01-01',
  designWidth: 375,
  deviceRatio: {
    375: 1,
    640: 1.706,
    750: 2,
    828: 2.208,
  },
  sourceRoot: 'src',
  outputRoot: `dist/${process.env.TARO_ENV || 'h5'}`,
  plugins: ['@tarojs/plugin-framework-react'],
  defineConstants: {
    'process.env.TARO_APP_API_BASE_URL': JSON.stringify(''),
  },
  copy: { patterns: [], options: {} },
  framework: 'react',
  compiler: {
    type: 'webpack5',
    prebundle: { enable: false },
  },
  mini: {
    postcss: {
      pxtransform: { enable: true, config: {} },
      cssModules: {
        enable: false,
        config: {
          namingPattern: 'module',
          generateScopedName: '[name]__[local]___[hash:base64:5]',
        },
      },
    },
  },
  h5: {
    publicPath: '/',
    staticDirectory: 'static',
    output: {
      filename: 'js/[name].[contenthash:8].js',
      chunkFilename: 'chunk/[name].[contenthash:8].js',
    },
    compile: {
      include: [path.resolve(__dirname, '..', '..', 'shared')],
    },
    postcss: {
      autoprefixer: { enable: true, config: {} },
      pxtransform: {
        enable: false,
      },
      cssModules: {
        enable: false,
        config: {
          namingPattern: 'module',
          generateScopedName: '[name]__[local]___[hash:base64:5]',
        },
      },
    },
    devServer: {
      port: 10086,
    },
  },
});

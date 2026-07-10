import * as path from 'path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
    
const __dirname = dirname(fileURLToPath(import.meta.url));

export default {
  mode: process.env.NODE_ENV || 'development',
  entry: {
    bundle: './src/main.tsx',
    calendarLab: './src/calendarLabMain.tsx',
  },
  output: {
    path: path.resolve(__dirname, '../dist/static/editor'),
    filename: '[name].js',
    clean: true, // Clean old builds
    publicPath: '/', // Adjust if using nested routes
  },
  resolve: {
    extensions: ['.js', '.jsx', '.ts', '.tsx'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /\.[jt]sx?$/,
        exclude: /node_modules/,
        loader: 'swc-loader',
        options: {
          jsc: {
            parser: {
              syntax: 'typescript',
              tsx: true,
            },
            transform: {
              react: {
                runtime: 'automatic',
              },
            },
          },
        },
      },
    ],
  },
  // plugins: [
  //   // Optional – use only if needed for dev
  //   new HtmlWebpackPlugin({
  //     template: 'template.html', // You can use a placeholder template
  //   }),
  // ],
};

import path from 'path';
import { defineConfig } from '@lark-apaas/coding-preset-vite-react';

export default defineConfig({
  resolve: {
    tsconfigPaths: false,
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
      '@client': path.resolve(__dirname, 'client'),
      '@shared': path.resolve(__dirname, 'shared'),
      '@lark-apaas/client-toolkit/tools': path.resolve(__dirname, 'node_modules/@lark-apaas/client-toolkit/lib/apis/tools'),
    },
  },
});

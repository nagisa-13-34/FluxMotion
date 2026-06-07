import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // Tauri 用設定
  server: {
    port: 1420,
    strictPort: true,
  },

  // Tauri の環境変数プレフィクスを許可
  envPrefix: ['VITE_', 'TAURI_'],

  // ビルド時のベースパス（Tauri はローカルファイルから読む）
  build: {
    target: 'esnext',
  },
})

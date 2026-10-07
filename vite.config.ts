import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 개발 서버에서 /api 는 ValuFlow backend(FastAPI)로 전달한다. OpenDART 와 API Key 는 backend 에만 있고 브라우저 번들에는 들어가지 않는다.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
});

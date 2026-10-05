import { defineConfig } from 'vite';

export default defineConfig({
resolve: {
alias: {
'@wasm-gaming/mgba-wasm':
'/node_modules/@wasm-gaming/mgba-wasm/dist/mgba/mgba.sdk.js',
},
},

optimizeDeps: {
exclude: ['@wasm-gaming/mgba-wasm'],
},

server: {
host: '0.0.0.0',
port: 5173,
},

preview: {
host: '0.0.0.0',
port: 4173,
},
});

// 開発サーバー (npm start) にだけ組み込まれる処理。
// Create React App が起動時に読み込む。本番用のビルドには含まれない。
// 画面からの /api への要求を、API サーバー (server/) へ中継する。
const { createProxyMiddleware } = require('http-proxy-middleware');

const API_PORT = process.env.IHUB_API_PORT || 4000;

module.exports = function (app) {
    app.use(createProxyMiddleware('/api', {
        target: `http://127.0.0.1:${API_PORT}`,
    }));
};

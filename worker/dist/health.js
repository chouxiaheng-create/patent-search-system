"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startHealthServer = startHealthServer;
// worker/src/health.ts
const express_1 = __importDefault(require("express"));
function startHealthServer(port = 3001) {
    const app = (0, express_1.default)();
    app.get('/health', (_req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });
    app.listen(port, () => {
        console.log(`[Health] Server running on port ${port}`);
    });
    return app;
}

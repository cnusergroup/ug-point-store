"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("vitest/config");
const path_1 = __importDefault(require("path"));
exports.default = (0, config_1.defineConfig)({
    test: {
        globals: true,
        environment: 'node',
        include: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.test.tsx', 'packages/cdk/lambda/**/*.test.ts', 'packages/cdk/test/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            include: ['packages/*/src/**/*.ts'],
            exclude: ['packages/*/src/**/*.test.ts', 'packages/cdk/**'],
        },
    },
    resolve: {
        alias: {
            '@points-mall/shared': path_1.default.resolve(__dirname, 'packages/shared/src'),
        },
    },
});
//# sourceMappingURL=vitest.config.js.map
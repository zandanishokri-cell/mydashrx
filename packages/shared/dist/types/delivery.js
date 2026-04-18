"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTerminalStatus = exports.TERMINAL_STATUSES = void 0;
/** All statuses that represent a stop no longer requiring driver action. */
exports.TERMINAL_STATUSES = ['completed', 'failed', 'rescheduled'];
const isTerminalStatus = (status) => exports.TERMINAL_STATUSES.includes(status);
exports.isTerminalStatus = isTerminalStatus;

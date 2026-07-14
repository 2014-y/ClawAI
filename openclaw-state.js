'use strict';
/**
 * 统一解析 OpenClaw 状态目录（多用户 / 云电脑安全）。
 * 优先环境变量（Electron 主进程 / patch_gateway 会注入），避免硬编码 Users\某人。
 */
const path = require('path');
const os = require('os');

function resolveOpenClawHome(env = process.env) {
    if (env.OPENCLAW_HOME && String(env.OPENCLAW_HOME).trim()) {
        return path.resolve(String(env.OPENCLAW_HOME).trim());
    }
    if (env.REAL_USER_HOME && String(env.REAL_USER_HOME).trim()) {
        return path.resolve(String(env.REAL_USER_HOME).trim());
    }
    const profile = env.USERPROFILE || env.HOME || '';
    if (profile) return path.resolve(profile);
    try {
        return path.resolve(os.homedir());
    } catch (e) {
        return path.resolve(process.cwd());
    }
}

function resolveOpenClawStateDir(env = process.env) {
    if (env.OPENCLAW_STATE_DIR && String(env.OPENCLAW_STATE_DIR).trim()) {
        return path.resolve(String(env.OPENCLAW_STATE_DIR).trim());
    }
    return path.join(resolveOpenClawHome(env), '.openclaw');
}

/** 学习/训练数据等业务目录：一律挂在状态目录下，不落用户家目录散装文件夹 */
function resolveLearningDataDir(env = process.env) {
    return path.join(resolveOpenClawStateDir(env), 'workspace', 'learning_data');
}

module.exports = {
    resolveOpenClawHome,
    resolveOpenClawStateDir,
    resolveLearningDataDir
};

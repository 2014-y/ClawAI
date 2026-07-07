/**
 * key-rotator v2 - Channel-aware API key load balancer
 * 
 * 按渠道分流:
 *   消息类 (微信/浏览器) → 固定 key-1 (低延迟)
 *   任务类 (训练/记忆/语音/桌面) → 加权轮询 key-2~7 (高吞吐)
 */

import { EventEmitter } from 'events';

export class KeyRotator {
    constructor(config) {
        this.strategy = config?.strategy || 'channel-aware';
        
        // 渠道分类
        this.messageChannels = ['openclaw-weixin', 'browser'];
        this.taskChannels = ['dual-model-trainer', 'memory-core', 'voice-call', 'computer-use', 'default'];
        
        // 消息类固定用 key-1
        this.messageProvider = 'agnes-ai-1';
        
        // 任务类加权轮询 key-2 ~ key-7
        this.taskWeights = {
            'agnes-ai-2': 1,
            'agnes-ai-3': 1,
            'agnes-ai-4': 1,
            'agnes-ai-5': 1,
            'agnes-ai-6': 1,
            'agnes-ai-7': 1
        };
        this.taskProviders = Object.keys(this.taskWeights);
        this.taskIndex = 0;
        
        // 健康状态
        this.health = {};
        this.failureCount = {};
        this.successCount = {};
        for (const p of [...this.taskProviders, this.messageProvider]) {
            this.health[p] = 'healthy';
            this.failureCount[p] = 0;
            this.successCount[p] = 0;
        }
        
        this.emitter = new EventEmitter();
        this.emitter.setMaxListeners(100);
        
        console.log('[key-rotator v2] Channel-aware mode');
        console.log('[key-rotator v2] Message channels →', this.messageProvider);
        console.log('[key-rotator v2] Task channels →', this.taskProviders.join(', '));
    }
    
    /**
     * 判断渠道类型
     */
    classifyChannel(source) {
        // source 可能是渠道名、插件名、或请求来源
        if (!source) return 'default';
        
        const src = typeof source === 'string' ? source.toLowerCase() : String(source);
        
        // 检查是否是消息类渠道
        for (const ch of this.messageChannels) {
            if (src.includes(ch)) return 'message';
        }
        
        // 检查是否是任务类渠道
        for (const ch of this.taskChannels) {
            if (src.includes(ch)) return 'task';
        }
        
        return 'default';
    }
    
    /**
     * 选择 provider
     */
    selectProvider(source) {
        const channel = this.classifyChannel(source);
        
        if (channel === 'message') {
            // 消息类固定走 key-1，保证低延迟
            if (this.health[this.messageProvider] !== 'healthy') {
                console.warn(`[key-rotator] ${this.messageProvider} unhealthy, fallback to task pool`);
                return this._selectTaskProvider();
            }
            return this.messageProvider;
        }
        
        // 任务类走加权轮询
        return this._selectTaskProvider();
    }
    
    /**
     * 任务类加权轮询 (round-robin + 健康检查)
     */
    _selectTaskProvider() {
        const healthy = this.taskProviders.filter(p => this.health[p] === 'healthy');
        if (healthy.length === 0) {
            console.warn('[key-rotator] No healthy task providers, using message provider');
            return this.messageProvider;
        }
        
        // Round-robin (简单轮询，健康检查自动处理异常)
        const idx = this.taskIndex % healthy.length;
        this.taskIndex++;
        
        return healthy[idx];
    }
    
    /**
     * 记录请求结果
     */
    recordResult(provider, success) {
        const threshold = 3;
        if (success) {
            this.failureCount[provider] = 0;
            this.successCount[provider]++;
            if (this.health[provider] === 'degraded') {
                this.health[provider] = 'healthy';
                console.log(`[key-rotator] ${provider} recovered`);
            }
        } else {
            this.failureCount[provider]++;
            if (this.failureCount[provider] >= threshold) {
                this.health[provider] = 'degraded';
                console.warn(`[key-rotator] ${provider} degraded`);
                this.emitter.emit('provider:degraded', provider);
            }
        }
    }
    
    /**
     * 健康检查 (仅任务类，消息类固定用 key-1 不检查)
     */
    startHealthCheck() {
        setInterval(async () => {
            for (const p of this.taskProviders) {
                if (this.health[p] !== 'healthy') continue;
                try {
                    const ctrl = new AbortController();
                    const tid = setTimeout(() => ctrl.abort(), 5000);
                    const resp = await fetch('https://apihub.agnes-ai.com/v1/models', {
                        headers: { 'Authorization': `Bearer ${this._getKey(p)}` },
                        signal: ctrl.signal
                    });
                    clearTimeout(tid);
                    if (!resp.ok) this.recordResult(p, false);
                } catch {
                    this.recordResult(p, false);
                }
            }
        }, 30000);
    }
    
    _getKey(provider) {
        const map = {
            'agnes-ai-1': 'sk-z2NHJlR99oODMYvS9C5u8qLMNf6hmc9vRm5JenvHHStTfxZn',
            'agnes-ai-2': 'sk-ct7MSvbC8LqL1gGqJuoVCKgjtecXwbjIUZhXQ0gITEaksCS0',
            'agnes-ai-3': 'sk-nZtkk9AAyZl3sbkv8Gw4R1R99NnkgUWhRGL4Cp0Dl7LSPsUu',
            'agnes-ai-4': 'sk-Y6ORz4nnuXHUpwjdXv2WlmLMwCfPBMtmh69iuXxZkQtZazyV',
            'agnes-ai-5': 'sk-GhS6TUB6W8LibJT5whDhbUvmYW3csM0HdGDdjotpgadQbd2F',
            'agnes-ai-6': 'sk-HV5HINAfAhMJOnYxYp83ZXDLqeudt8ofLtdm9Bj5p9SUOUGh',
            'agnes-ai-7': 'sk-95sX8HnNOhh8FFfAm3ccOgGFg6MA8yf7zU5PEEQdGxSuKhQY'
        };
        return map[provider] || '';
    }
    
    getStats() {
        const stats = {};
        for (const p of [...this.taskProviders, this.messageProvider]) {
            stats[p] = {
                health: this.health[p],
                failures: this.failureCount[p],
                successes: this.successCount[p]
            };
        }
        return stats;
    }
}

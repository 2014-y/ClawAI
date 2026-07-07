import { KeyRotator } from './key-rotator.mjs';

export async function init(config) {
    const rotator = new KeyRotator(config || {});
    rotator.startHealthCheck();

    return {
        name: '@openclaw/key-rotator',
        version: '2.0.0',
        rotator: rotator,

        onRequest: async (request) => {
            const provider = rotator.selectProvider(request.source || request.channel);
            request.provider = provider;
            return request;
        },

        onResponse: async (response, success) => {
            rotator.recordResult(response.provider, success);
        },

        getStats: () => rotator.getStats()
    };
}

export { KeyRotator };

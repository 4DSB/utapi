const Redis = require('ioredis');

/**
* Creates a new Redis client instance
* @param {object} config - redis configuration
* @param {Werelogs} log - Werelogs logger
* @return {Redis} - Redis client instance
*/
function redisClient(config, log) {
    const redisClient = new Redis(Object.assign({
        // disable offline queue
        enableOfflineQueue: true,
        // keep alive 3 seconds
        keepAlive: 3000,
    }, config));
    redisClient.on('error', err => log.trace('error with redis client', {
        error: err,
    }));
    return redisClient;
}

module.exports = redisClient;

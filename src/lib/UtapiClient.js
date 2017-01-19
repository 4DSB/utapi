import assert from 'assert';
import async from 'async';
import { Logger } from 'werelogs';
import Datastore from './Datastore';
import { generateKey, generateCounter, getCounters, generateStateKey }
    from './schema';
import { errors } from 'arsenal';
import redisClient from '../utils/redisClient';

const methods = {
    createBucket: '_pushMetricCreateBucket',
    deleteBucket: '_genericPushMetric',
    listBucket: '_genericPushMetric',
    getBucketAcl: '_genericPushMetric',
    putBucketAcl: '_genericPushMetric',
    putBucketWebsite: '_genericPushMetric',
    getBucketWebsite: '_genericPushMetric',
    deleteBucketWebsite: '_genericPushMetric',
    uploadPart: '_pushMetricUploadPart',
    initiateMultipartUpload: '_genericPushMetric',
    completeMultipartUpload: '_pushMetricCompleteMultipartUpload',
    listMultipartUploads: '_pushMetricListBucketMultipartUploads',
    listMultipartUploadParts: '_genericPushMetric',
    abortMultipartUpload: '_genericPushMetric',
    deleteObject: '_genericPushMetricDeleteObject',
    multiObjectDelete: '_genericPushMetricDeleteObject',
    getObject: '_pushMetricGetObject',
    getObjectAcl: '_genericPushMetric',
    putObject: '_pushMetricPutObject',
    copyObject: '_pushMetricCopyObject',
    putObjectAcl: '_genericPushMetric',
    headBucket: '_genericPushMetric',
    headObject: '_genericPushMetric',
};

const metricObj = {
    buckets: 'bucket',
    accounts: 'accountId',
    services: 'service',
};

export default class UtapiClient {
    constructor(config) {
        this.disableClient = true;
        this.log = null;
        this.ds = null;
        // setup logger
        if (config && config.log) {
            this.log = new Logger('UtapiClient', { level: config.log.level,
                    dump: config.log.dumpLevel });
        } else {
            this.log = new Logger('UtapiClient', { level: 'info',
                dump: 'error' });
        }
        // setup datastore
        if (config && config.redis) {
            this.ds = new Datastore()
                .setClient(redisClient(config.redis, this.log));
            this.disableClient = false;
        }
        if (config && config.metrics) {
            this.metrics = config.metrics;
        }
        if (config) {
            assert(config.component, 'Must include `component` property in ' +
                'the configuration of Utapi');
            this.component = config.component;
        }
    }

    /**
    * Normalizes timestamp precision to the nearest 15 minutes to
    * reduce the number of entries in a sorted set
    * @return {number} timestamp - normalized to the nearest 15 minutes
    */
    static getNormalizedTimestamp() {
        const d = new Date();
        const minutes = d.getMinutes();
        return d.setMinutes((minutes - minutes % 15), 0, 0);
    }

    /**
    * set datastore
    * @param {DataStore} ds - Datastore instance
    * @return {object} current instance
    */
    setDataStore(ds) {
        this.ds = ds;
        this.disableClient = false;
        return this;
    }

    /*
    * Utility function to use when callback is not defined
    */
    _noop() {}

   /**
    * Check the types of `params` object properties. This enforces object
    * properties for particular push metric calls.
    * @param {object} params - params object with metric data
    * @param {number} [params.byteLength] - (optional) size of an object deleted
    * @param {number} [params.newByteLength] - (optional) new object size
    * @param {number|null} [params.oldByteLength] - (optional) old object size
    * (for object overwrites). This value can be `null` for a new object,
    * or >= 0 for an existing object with content-length 0 or greater than 0.
    * @param {number} [params.numberOfObjects] - (optional) number of obects
    * @param {array} properties - (option) properties to assert types for
    * @return {undefined}
    */
    _checkProperties(params, properties = []) {
        properties.forEach(prop => {
            assert(params[prop] !== undefined, 'Metric object must include ' +
                `${prop} property`);
            if (prop === 'oldByteLength') {
                assert(typeof params[prop] === 'number' ||
                    params[prop] === null, 'oldByteLength  property must be ' +
                    'an integer or `null`');
            } else {
                assert(typeof params[prop] === 'number', `${prop} property ` +
                    'must be an integer');
            }
        });
    }


    /**
     * Check that the expected properties for metric levels (as defined in
     * the config) are in the object passed to the client. Otherwise, ensure
     * that there is at least one metric level to push metrics for.
     * @param {object} params - params object with metric data
     * @param {string} [params.bucket] - (optional) bucket name
     * @param {string} [params.accountId] - (optional) account ID
     * @return {undefined}
     */
    _checkMetricTypes(params) {
        // Object of metric types and their associated property names
        if (this.metrics) {
            this.metrics.forEach(level => {
                const propName = metricObj[level];
                assert(typeof params[propName] === 'string' ||
                    params[propName] === undefined,
                    `${propName} must be a string`);
            });
        } else {
            assert(Object.keys(metricObj).some(level =>
                metricObj[level] in params), 'Must include a metric level');
        }
    }

    /**
     * Utility function to log the metric being pushed.
     * @param {object} params - params object with metric data
     * @param {string} method - the name of the method being logged
     * @param {number} timestamp - normalized timestamp of current time
     * @param {object} log - Werelogs request logger
     * @return {undefined}
     */
    _logMetric(params, method, timestamp, log) {
        const logObject = {
            method: `UtapiClient.${method}`,
            timestamp,
        };
        const metricTypes = ['bucket', 'accountId', 'service'];
        const metricType = metricTypes.find(type => type in params);
        logObject[metricType] = params[metricType];
        log.trace('pushing metric', logObject);
    }

    /**
     * Creates an array of parameter objects for each metric type. The number
     * of objects in the array will be the number of metric types included in
     * the `params` object.
     * @param {object} params - params object with metric data
     * @return {object []} arr - array of parameter objects for push metric call
     */
    _getParamsArr(params) {
        this._checkMetricTypes(params);
        // Only push metric levels defined in the config, otherwise push any
        // levels that are passed in the object
        const levels = this.metrics ? this.metrics : Object.keys(metricObj);
        const props = ['service'];
        for (let i = 0; i < levels.length; i++) {
            const prop = metricObj[levels[i]];
            if (params[prop] !== undefined) {
                props.push(metricObj[levels[i]]);
            }
        }
        const metricProps = ['byteLength', 'newByteLength', 'oldByteLength',
            'numberOfObjects'];
        // If the config specifies service level metrics, include them.
        return props.map(type => {
            const typeObj = {};
            typeObj[type] = params[type];
            // We need to add a `service` property to any non-service level
            // `typeObj` to be able to build the appropriate schema key.
            typeObj.service = this.component;
            // Include properties that are not metric types
            // (e.g., 'oldByteLength', 'newByteLength', etc.)
            Object.keys(params).forEach(k => {
                // Get other properties, but do not include `undefined` ones
                // or any unrelated properties (those not in `metricProps`).
                if (props.indexOf(k) < 0 && params[k] !== undefined &&
                metricProps.indexOf(k) >= 0) {
                    typeObj[k] = params[k];
                }
            });
            return typeObj;
        });
    }

    /**
    * Callback for methods used to push metrics to Redis
    * @callback pushMetric callback
    * @param {object} err - ArsenalError instance
    */

    /**
    * Generic method exposed by the client to push a metric with some values.
    * `params` can be expanded to provide metrics for metric granularities
    * (e.g. 'bucket', 'account').
    * @param {string} metric - metric to be published
    * @param {string} reqUid - Request Unique Identifier
    * @param {object} params - params object with metric data
    * @param {string} [params.bucket] - (optional) bucket name
    * @param {string} [params.accountId] - (optional) account id
    * @param {number} [params.byteLength] - (optional) size of an object deleted
    * @param {number} [params.newByteLength] - (optional) new object size
    * @param {number|null} [params.oldByteLength] - (optional) old object size
    * (for object overwrites). This value can be `null` for a new object,
    * or >= 0 for an existing object with content-length 0 or greater than 0.
    * @param {number} [params.numberOfObjects] - (optional) number of obects
    * added/deleted
    * @param {callback} [cb] - (optional) callback to call
    * @return {undefined}
    */
    pushMetric(metric, reqUid, params, cb) {
        assert(methods[metric], `${metric} metric is not handled by Utapi`);
        const callback = cb || this._noop;
        if (this.disableClient) {
            return callback();
        }
        const log = this.log.newRequestLoggerFromSerializedUids(reqUid);
        const timestamp = UtapiClient.getNormalizedTimestamp();
        const paramsArray = this._getParamsArr(params);
        // Push metrics for each metric type included in the `params` object.
        return async.each(paramsArray, (params, callback) => {
            this[methods[metric]](params, timestamp, metric, log, callback);
        }, err => callback(err));
    }

    /**
    * Updates counter for CreateBucket action
    * @param {object} params - params for the metrics
    * @param {string} [params.bucket] - (optional) bucket name
    * @param {string} [params.accountId] - (optional) account ID
    * @param {number} timestamp - normalized timestamp of current time
    * @param {string} action - action to push metric for
    * @param {object} log - Werelogs request logger
    * @param {callback} callback - callback to call
    * @return {undefined}
    */
    _pushMetricCreateBucket(params, timestamp, action, log, callback) {
        this._checkProperties(params);
        this._logMetric(params, '_pushMetricCreateBucket', timestamp, log);
        // set storage utilized and number of objects counters to 0,
        // indicating the start of the bucket timeline
        const cmds = getCounters(params).map(item => ['set', item, 0]);
        cmds.push(
            // remove old timestamp entries
            ['zremrangebyscore',
                generateStateKey(params, 'storageUtilized'), timestamp,
                timestamp],
            ['zremrangebyscore', generateStateKey(params, 'numberOfObjects'),
                timestamp, timestamp],
            // add new timestamp entries
            ['zadd', generateStateKey(params, 'storageUtilized'), timestamp, 0],
            ['zadd', generateStateKey(params, 'numberOfObjects'), timestamp, 0]
        );
        // CreateBucket action occurs only once in a bucket's lifetime, so for
        // bucket-level metrics, counter is always 1.
        if ('bucket' in params) {
            cmds.push(['set', generateKey(params, action, timestamp), 1]);
        } else {
            cmds.push(['incr', generateKey(params, action, timestamp)]);
        }
        return this.ds.batch(cmds, err => {
            if (err) {
                log.error('error incrementing counter', {
                    method: 'Buckets._pushMetricCreateBucket',
                    error: err,
                });
                return callback(errors.InternalError);
            }
            return callback();
        });
    }

    /**
    * Updates counter for the given action
    * @param {object} params - params for the metrics
    * @param {string} [params.bucket] - (optional) bucket name
    * @param {string} [params.accountId] - (optional) account ID
    * @param {number} timestamp - normalized timestamp of current time
    * @param {string} action - action metric to update
    * @param {object} log - Werelogs request logger
    * @param {callback} callback - callback to call
    * @return {undefined}
    */
    _genericPushMetric(params, timestamp, action, log, callback) {
        this._checkProperties(params);
        this._logMetric(params, '_genericPushMetric', timestamp, log);
        const key = generateKey(params, action, timestamp);
        return this.ds.incr(key, err => {
            if (err) {
                log.error('error incrementing counter', {
                    method: 'UtapiClient._genericPushMetric',
                    error: err,
                });
                return callback(errors.InternalError);
            }
            return callback();
        });
    }

    /**
    * Updates counter for UploadPart action
    * @param {object} params - params for the metrics
    * @param {string} [params.bucket] - (optional) bucket name
    * @param {string} [params.accountId] - (optional) account ID
    * @param {number} params.newByteLength - size of object in bytes
    * @param {number} timestamp - normalized timestamp of current time
    * @param {string} action - action metric to update
    * @param {object} log - Werelogs request logger
    * @param {callback} callback - callback to call
    * @return {undefined}
    */
    _pushMetricUploadPart(params, timestamp, action, log, callback) {
        this._checkProperties(params, ['newByteLength']);
        const { newByteLength } = params;
        this._logMetric(params, '_pushMetricUploadPart', timestamp, log);
        // update counters
        return this.ds.batch([
            ['incrby', generateCounter(params, 'storageUtilizedCounter'),
                newByteLength],
            ['incrby', generateKey(params, 'incomingBytes', timestamp),
                newByteLength],
            ['incr', generateKey(params, action, timestamp)],
        ], (err, results) => {
            if (err) {
                log.error('error pushing metric', {
                    method: 'UtapiClient._pushMetricUploadPart',
                    error: err,
                });
                return callback(errors.InternalError);
            }
            // storage utilized counter
            const actionErr = results[0][0];
            const actionCounter = results[0][1];
            if (actionErr) {
                log.error('error incrementing counter for push metric', {
                    method: 'UtapiClient._pushMetricUploadPart',
                    metric: 'storage utilized',
                    error: actionErr,
                });
                return callback(errors.InternalError);
            }

            return this.ds.batch([
                ['zremrangebyscore',
                    generateStateKey(params, 'storageUtilized'),
                    timestamp, timestamp],
                ['zadd', generateStateKey(params, 'storageUtilized'),
                    timestamp, actionCounter],
            ], callback);
        });
    }

    /**
    * Updates counter for CompleteMultipartUpload action
    * @param {object} params - params for the metrics
    * @param {string} [params.bucket] - (optional) bucket name
    * @param {string} [params.accountId] - (optional) account ID
    * @param {number} timestamp - normalized timestamp of current time
    * @param {string} action - action metric to update
    * @param {object} log - Werelogs request logger
    * @param {callback} callback - callback to call
    * @return {undefined}
    */
    _pushMetricCompleteMultipartUpload(params, timestamp, action, log,
        callback) {
        this._checkProperties(params);
        this._logMetric(params, '_pushMetricCompleteMultipartUpload', timestamp,
            log);
        return this.ds.batch([
            ['incr', generateCounter(params, 'numberOfObjectsCounter')],
            ['incr', generateKey(params, action, timestamp)],
        ], (err, results) => {
            if (err) {
                log.error('error incrementing counter for push metric', {
                    method: 'UtapiClient._pushMetricCompleteMultipartUpload',
                    metric: 'number of objects',
                    error: err,
                });
                return callback(errors.InternalError);
            }
            // number of objects counter
            const actionErr = results[0][0];
            const actionCounter = results[0][1];
            if (actionErr) {
                log.error('error incrementing counter for push metric', {
                    method: 'UtapiClient._pushMetricCompleteMultipartUpload',
                    metric: 'number of objects',
                    error: actionErr,
                });
                return callback(errors.InternalError);
            }
            const key = generateStateKey(params, 'numberOfObjects');
            return this.ds.batch([
                ['zremrangebyscore', key, timestamp, timestamp],
                ['zadd', key, timestamp, actionCounter],
            ], callback);
        });
    }

    /**
    * Updates counter for listBucketMultipartUploads action
    * @param {object} params - params for the metrics
    * @param {string} [params.bucket] - (optional) bucket name
    * @param {string} [params.accountId] - (optional) account ID
    * @param {number} timestamp - normalized timestamp of current time
    * @param {string} action - action metric to update
    * @param {object} log - Werelogs request logger
    * @param {callback} callback - callback to call
    * @return {undefined}
    */
    _pushMetricListBucketMultipartUploads(params, timestamp, action, log,
        callback) {
        return this._genericPushMetric(params, timestamp,
            'listBucketMultipartUploads', log, callback);
    }

    /**
    * Updates counter for DeleteObject or MultiObjectDelete action
    * @param {object} params - params for the metrics
    * @param {string} [params.bucket] - (optional) bucket name
    * @param {string} [params.accountId] - (optional) account ID
    * @param {number} params.byteLength - size of the object deleted
    * @param {number} params.numberOfObjects - number of objects deleted
    * @param {number} timestamp - normalized timestamp of current time
    * @param {string} action - action metric to update
    * @param {object} log - Werelogs request logger
    * @param {callback} callback - callback to call
    * @return {undefined}
    */
    _genericPushMetricDeleteObject(params, timestamp, action, log, callback) {
        this._checkProperties(params, ['byteLength', 'numberOfObjects']);
        const { byteLength, numberOfObjects } = params;
        this._logMetric(params, '_genericPushMetricDeleteObject', timestamp,
            log);
        return this.ds.batch([
            ['decrby', generateCounter(params, 'storageUtilizedCounter'),
                byteLength],
            ['decrby', generateCounter(params, 'numberOfObjectsCounter'),
                numberOfObjects],
            ['incr', generateKey(params, action, timestamp)],
        ], (err, results) => {
            if (err) {
                log.error('error incrementing counter', {
                    method: 'UtapiClient._genericPushMetricDeleteObject',
                    error: err,
                });
                return callback(errors.InternalError);
            }

            const cmds = [];
            // storage utilized counter
            let actionErr = results[0][0];
            let actionCounter = parseInt(results[0][1], 10);
            actionCounter = actionCounter < 0 ? 0 : actionCounter;
            if (actionErr) {
                log.error('error incrementing counter for push metric', {
                    method: 'UtapiClient._genericPushMetricDeleteObject',
                    metric: 'storage utilized',
                    error: actionErr,
                });
                return callback(errors.InternalError);
            }
            cmds.push(
                ['zremrangebyscore',
                    generateStateKey(params, 'storageUtilized'),
                    timestamp, timestamp],
                ['zadd',
                    generateStateKey(params, 'storageUtilized'),
                    timestamp, actionCounter]);

            // num of objects counter
            actionErr = results[1][0];
            actionCounter = parseInt(results[1][1], 10);
            actionCounter = actionCounter < 0 ? 0 : actionCounter;
            if (actionErr) {
                log.error('error incrementing counter for push metric', {
                    method: 'UtapiClient._genericPushMetricDeleteObject',
                    metric: 'num of objects',
                    error: actionErr,
                });
                return callback(errors.InternalError);
            }
            cmds.push(
                ['zremrangebyscore',
                    generateStateKey(params, 'numberOfObjects'), timestamp,
                    timestamp],
                ['zadd', generateStateKey(params, 'numberOfObjects'),
                    timestamp, actionCounter]);
            return this.ds.batch(cmds, callback);
        });
    }

    /**
    * Updates counter for GetObject action
    * @param {object} params - params for the metrics
    * @param {string} [params.bucket] - (optional) bucket name
    * @param {string} [params.accountId] - (optional) account ID
    * @param {number} params.newByteLength - size of object in bytes
    * @param {number} timestamp - normalized timestamp of current time
    * @param {string} action - action metric to update
    * @param {object} log - Werelogs request logger
    * @param {callback} callback - callback to call
    * @return {undefined}
    */
    _pushMetricGetObject(params, timestamp, action, log, callback) {
        this._checkProperties(params, ['newByteLength']);
        const { newByteLength } = params;
        this._logMetric(params, '_pushMetricGetObject', timestamp, log);
        // update counters
        return this.ds.batch([
            ['incrby', generateKey(params, 'outgoingBytes', timestamp),
                newByteLength],
            ['incr', generateKey(params, action, timestamp)],
        ], err => {
            if (err) {
                log.error('error pushing metric', {
                    method: 'UtapiClient._pushMetricGetObject',
                    error: err,
                });
                return callback(errors.InternalError);
            }
            return callback();
        });
    }


    /**
    * Updates counter for PutObject action
    * @param {object} params - params for the metrics
    * @param {string} [params.bucket] - (optional) bucket name
    * @param {string} [params.accountId] - (optional) account ID
    * @param {number} params.newByteLength - size of object in bytes
    * @param {number} params.oldByteLength - previous size of object
    * in bytes if this action overwrote an existing object
    * @param {number} timestamp - normalized timestamp of current time
    * @param {string} action - action metric to update
    * @param {object} log - Werelogs request logger
    * @param {callback} callback - callback to call
    * @return {undefined}
    */
    _pushMetricPutObject(params, timestamp, action, log, callback) {
        this._checkProperties(params, ['newByteLength', 'oldByteLength']);
        const { newByteLength, oldByteLength } = params;
        let numberOfObjectsCounter;
        // if previous object size is null then it's a new object in a bucket
        // or else it's an old object being overwritten
        if (oldByteLength === null) {
            numberOfObjectsCounter = ['incr', generateCounter(params,
                'numberOfObjectsCounter')];
        } else {
            numberOfObjectsCounter = ['get', generateCounter(params,
                'numberOfObjectsCounter')];
        }
        const oldObjSize = oldByteLength === null ? 0 : oldByteLength;
        const storageUtilizedDelta = newByteLength - oldObjSize;
        this._logMetric(params, '_pushMetricPutObject', timestamp, log);
        // update counters
        return this.ds.batch([
            ['incrby', generateCounter(params, 'storageUtilizedCounter'),
                storageUtilizedDelta],
            numberOfObjectsCounter,
            ['incrby', generateKey(params, 'incomingBytes', timestamp),
                newByteLength],
            ['incr', generateKey(params, action, timestamp)],
        ], (err, results) => {
            if (err) {
                log.error('error pushing metric', {
                    method: 'UtapiClient._pushMetricPutObject',
                    error: err,
                });
                return callback(errors.InternalError);
            }
            const cmds = [];
            let actionErr;
            let actionCounter;
            // storage utilized counter
            actionErr = results[0][0];
            actionCounter = results[0][1];
            if (actionErr) {
                log.error('error incrementing counter for push metric', {
                    method: 'UtapiClient._pushMetricPutObject',
                    metric: 'storage utilized',
                    error: actionErr,
                });
                return callback(errors.InternalError);
            }
            cmds.push(
                ['zremrangebyscore',
                    generateStateKey(params, 'storageUtilized'),
                    timestamp, timestamp],
                ['zadd', generateStateKey(params, 'storageUtilized'),
                    timestamp, actionCounter]);

            // number of objects counter
            actionErr = results[1][0];
            actionCounter = results[1][1];
            if (actionErr) {
                log.error('error incrementing counter for push metric', {
                    method: 'UtapiClient._pushMetricPutObject',
                    metric: 'number of objects',
                    error: actionErr,
                });
                return callback(errors.InternalError);
            }
            cmds.push(
                ['zremrangebyscore',
                    generateStateKey(params, 'numberOfObjects'),
                    timestamp, timestamp],
                ['zadd', generateStateKey(params, 'numberOfObjects'),
                    timestamp, actionCounter]);
            return this.ds.batch(cmds, callback);
        });
    }

    /**
    * Updates counter for CopyObject action
    * @param {object} params - params for the metrics
    * @param {string} [params.bucket] - (optional) bucket name
    * @param {string} [params.accountId] - (optional) account ID
    * @param {number} params.newByteLength - size of object in bytes
    * @param {number} params.oldByteLength - previous size of object in bytes
    * if this action overwrote an existing object
    * @param {number} timestamp - normalized timestamp of current time
    * @param {string} action - action metric to update
    * @param {object} log - Werelogs request logger
    * @param {callback} callback - callback to call
    * @return {undefined}
    */
    _pushMetricCopyObject(params, timestamp, action, log, callback) {
        this._checkProperties(params, ['newByteLength', 'oldByteLength']);
        const { newByteLength, oldByteLength } = params;
        let numberOfObjectsCounter;
        // if previous object size is null then it's a new object in a bucket
        // or else it's an old object being overwritten
        if (oldByteLength === null) {
            numberOfObjectsCounter = ['incr', generateCounter(params,
                'numberOfObjectsCounter')];
        } else {
            numberOfObjectsCounter = ['get', generateCounter(params,
                'numberOfObjectsCounter')];
        }
        const oldObjSize = oldByteLength === null ? 0 : oldByteLength;
        const storageUtilizedDelta = newByteLength - oldObjSize;
        this._logMetric(params, '_pushMetricCopyObject', timestamp, log);
        // update counters
        return this.ds.batch([
            ['incrby', generateCounter(params, 'storageUtilizedCounter'),
                storageUtilizedDelta],
            numberOfObjectsCounter,
            ['incr', generateKey(params, action, timestamp)],
        ], (err, results) => {
            if (err) {
                log.error('error pushing metric', {
                    method: 'UtapiClient._pushMetricCopyObject',
                    error: err,
                });
                return callback(errors.InternalError);
            }
            const cmds = [];
            let actionErr;
            let actionCounter;
            // storage utilized counter
            actionErr = results[0][0];
            actionCounter = results[0][1];
            if (actionErr) {
                log.error('error incrementing counter for push metric', {
                    method: 'UtapiClient._pushMetricCopyObject',
                    metric: 'storage utilized',
                    error: actionErr,
                });
                return callback(errors.InternalError);
            }
            cmds.push(
                ['zremrangebyscore',
                    generateStateKey(params, 'storageUtilized'),
                    timestamp, timestamp],
                ['zadd', generateStateKey(params, 'storageUtilized'),
                    timestamp, actionCounter]);

            // number of objects counter
            actionErr = results[1][0];
            actionCounter = results[1][1];
            if (actionErr) {
                log.error('error incrementing counter for push metric', {
                    method: 'UtapiClient._pushMetricCopyObject',
                    metric: 'number of objects',
                    error: actionErr,
                });
                return callback(errors.InternalError);
            }
            cmds.push(
                ['zremrangebyscore',
                    generateStateKey(params, 'numberOfObjects'),
                    timestamp, timestamp],
                ['zadd', generateStateKey(params, 'numberOfObjects'),
                    timestamp, actionCounter]);
            return this.ds.batch(cmds, callback);
        });
    }
}

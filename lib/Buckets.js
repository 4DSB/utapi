import async from 'async';
import { errors } from 'arsenal';
import { getMetricFromKey, getBucketKeys, genBucketStateKey } from './schema';

/**
* Provides static methods to get bucket level metrics
*/
export default class Buckets {

    /**
    * Callback for getting metrics for a list of buckets
    * @callback Buckets~bucketsMetricsCb
    * @param {object} err - ArsenalError instance
    * @param {object[]} buckets - list of objects containing metrics for each
    * bucket provided in the request
    */

    /**
    * Get metrics for a list of buckets
    * @param {utapiRequest} utapiRequest - utapiRequest instance
    * @param {Buckets~bucketsMetricsCb} cb - callback
    * @return {undefined}
    */
    static getBucketsMetrics(utapiRequest, cb) {
        const log = utapiRequest.getLog();
        const validator = utapiRequest.getValidator();
        const buckets = validator.get('buckets');
        const timeRange = validator.get('timeRange');
        const datastore = utapiRequest.getDatastore();
        async.mapLimit(buckets, 5, (bucket, next) =>
            Buckets.getBucketMetrics(bucket, timeRange, datastore, log, next),
            cb
        );
    }

    /**
    * Returns a list of timestamps incremented by 15 min. from start timestamp
    * to end timestamp
    * @param {number} start - start timestamp
    * @param {number} end - end timestamp
    * @return {number[]} range - array of timestamps
    */
    static getTimestampRange(start, end) {
        const res = [];
        let last = start;
        while (last < end) {
            res.push(last);
            const d = new Date(last);
            last = d.setMinutes(d.getMinutes() + 15);
        }
        res.push(end);
        return res;
    }

    /**
    * Callback for getting metrics for a single bucket
    * @callback Buckets~getBucketMetricsCb
    * @param {object} err - ArsenalError instance
    * @param {object} bucket - metrics for a single bucket
    * @param {string} bucket.bucketName - name of the bucket
    * @param {number[]} bucket.timeRange - start and end times as unix epoch
    * @param {number[]} bucket.storageUtilized - storage utilized by the
    * bucket at start and end time. These are absolute values
    * @param {number} bucket.incomingBytes - number of bytes received by the
    * bucket as object puts or mutlipart uploads
    * @param {number} bucket.outgoingBytes - number of bytes transferred to
    * the clients from the objects belonging to the bucket
    * @param {number[]} bucket.numberOfObjects - number of objects held by
    * the bucket at start and end times. These are absolute values.
    * @param {object} bucket.operations - object containing s3 operations
    * and their counters, with the specific S3 operation as key and total count
    * of operations that happened between start time and end time as value
    */

    /**
    * Get metrics for a single bucket
    * @param {string} bucket - bucket name
    * @param {number[]} range - time range with start time and end time as
    * it's members in unix epoch timestamp format
    * @param {object} datastore - Datastore instance
    * @param {object} log - Werelogs logger instance
    * @param {Buckets~getBucketMetricsCb} cb - callback
    * @return {undefined}
    */
    static getBucketMetrics(bucket, range, datastore, log, cb) {
        const start = range[0];
        const end = range[1] || Date.now();

        // find nearest neighbors for absolutes
        const storageUtilizedKey = genBucketStateKey(bucket, 'storageUtilized');
        const numberOfObjectsKey = genBucketStateKey(bucket, 'numberOfObjects');
        const storageUtilizedStart = ['zrevrangebyscore', storageUtilizedKey,
            start, '-inf', 'LIMIT', '0', '1'];
        const storageUtilizedEnd = ['zrevrangebyscore', storageUtilizedKey, end,
            '-inf', 'LIMIT', '0', '1'];
        const numberOfObjectsStart = ['zrevrangebyscore', numberOfObjectsKey,
            start, '-inf', 'LIMIT', '0', '1'];
        const numberOfObjectsEnd = ['zrevrangebyscore', numberOfObjectsKey, end,
            '-inf', 'LIMIT', '0', '1'];
        const timestampRange = Buckets.getTimestampRange(start, end);
        const bucketKeys = [].concat.apply([], timestampRange.map(
            i => getBucketKeys(bucket, i)));
        const cmds = bucketKeys.map(item => ['get', item]);
        cmds.push(storageUtilizedStart, storageUtilizedEnd,
            numberOfObjectsStart, numberOfObjectsEnd);

        datastore.batch(cmds, (err, res) => {
            if (err) {
                log.trace('error occurred while getting bucket metrics', {
                    error: err,
                    method: 'Buckets.getBucketMetrics',
                    bucket,
                });
                return cb(errors.InternalError);
            }
            const bucketRes = {
                bucketName: bucket,
                timeRange: [start, end],
                storageUtilized: [0, 0],
                incomingBytes: 0,
                outgoingBytes: 0,
                numberOfObjects: [0, 0],
                operations: {
                    's3:DeleteBucket': 0,
                    's3:ListBucket': 0,
                    's3:GetBucketAcl': 0,
                    's3:CreateBucket': 0,
                    's3:PutBucketAcl': 0,
                    's3:PutObject': 0,
                    's3:UploadPart': 0,
                    's3:ListBucketMultipartUploads': 0,
                    's3:ListMultipartUploadParts': 0,
                    's3:InitiateMultipartUpload': 0,
                    's3:CompleteMultipartUpload': 0,
                    's3:AbortMultipartUpload': 0,
                    's3:DeleteObject': 0,
                    's3:GetObject': 0,
                    's3:GetObjectAcl': 0,
                    's3:PutObjectAcl': 0,
                    's3:HeadBucket': 0,
                    's3:HeadObject': 0,
                },
            };

            // last 4 are results of storageUtilized, numberOfObjects,
            const absolutes = res.slice(-4);
            const deltas = res.slice(0, res.length - 4);
            absolutes.forEach((item, index) => {
                if (item[0]) {
                    // log error and continue
                    log.trace('command in a batch failed to execute', {
                        error: item[0],
                        method: 'Buckets.getBucketMetrics',
                    });
                } else {
                    let val = parseInt(item[1], 10);
                    val = isNaN(val) ? 0 : val;
                    if (index === 0) {
                        bucketRes.storageUtilized[0] = val;
                    } else if (index === 1) {
                        bucketRes.storageUtilized[1] = val;
                    } else if (index === 2) {
                        bucketRes.numberOfObjects[0] = val;
                    } else if (index === 3) {
                        bucketRes.numberOfObjects[1] = val;
                    }
                }
            });

            /**
            * Batch result is of the format
            * [ [null, '1'], [null, '2'], [null, '3'] ] where each
            * item is the result of the each batch command
            * Foreach item in the resut, index 0 signifies the error and
            * index 1 contains the result
            */
            deltas.forEach((item, index) => {
                const key = bucketKeys[index];
                if (item[0]) {
                    // log error and continue
                    log.trace('command in a batch failed to execute', {
                        error: item[0],
                        method: 'Buckets.getBucketMetrics',
                        cmd: key,
                    });
                } else {
                    const m = getMetricFromKey(key, bucket);
                    let count = parseInt(item[1], 10);
                    count = Number.isNaN(count) ? 0 : count;
                    if (m === 'incomingBytes' || m === 'outgoingBytes') {
                        bucketRes[m] += count;
                    } else {
                        bucketRes.operations[`s3:${m}`] += count;
                    }
                }
            });
            return cb(null, bucketRes);
        });
    }
}

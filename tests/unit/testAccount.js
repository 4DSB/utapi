import assert from 'assert';
import Account from '../../src/lib/Account';
import MemoryBackend from '../../src/lib/backend/Memory';
import Datastore from '../../src/lib/Datastore';
import { generateStateKey, generateKey } from '../../src/lib/schema';
import { Logger } from 'werelogs';
const logger = new Logger('UtapiTest');
const testAccount = '0123456789abcdef';
const memBackend = new MemoryBackend();
const datastore = new Datastore();
datastore.setClient(memBackend);

function assertMetrics(account, props, done) {
    const timestamp = new Date().setMinutes(0, 0, 0);
    const timeRange = [timestamp, timestamp];
    const expectedRes = {
        accountId: '0123456789abcdef',
        timeRange: [],
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
            's3:PutBucketWebsite': 0,
            's3:DeleteBucketWebsite': 0,
            's3:GetBucketWebsite': 0,
            's3:PutObject': 0,
            's3:CopyObject': 0,
            's3:UploadPart': 0,
            's3:ListBucketMultipartUploads': 0,
            's3:ListMultipartUploadParts': 0,
            's3:InitiateMultipartUpload': 0,
            's3:CompleteMultipartUpload': 0,
            's3:AbortMultipartUpload': 0,
            's3:DeleteObject': 0,
            's3:MultiObjectDelete': 0,
            's3:GetObject': 0,
            's3:GetObjectAcl': 0,
            's3:PutObjectAcl': 0,
            's3:HeadBucket': 0,
            's3:HeadObject': 0,
        },
    };
    const expectedResProps = props || {};
    Account.getMetrics(account, timeRange, datastore, logger,
        (err, res) => {
            assert.strictEqual(err, null);
            // overwrite operations metrics
            if (expectedResProps.operations) {
                Object.assign(expectedRes.operations,
                    expectedResProps.operations);
                delete expectedResProps.operations;
            }
            assert.deepStrictEqual(res, Object.assign(expectedRes,
                { timeRange }, expectedResProps));
            done();
        });
}

function testOps(keyIndex, metricindex, done) {
    const timestamp = new Date().setMinutes(0, 0, 0);
    let key;
    let props = {};
    let val;
    if (keyIndex === 'storageUtilized' || keyIndex === 'numberOfObjects') {
        key = generateStateKey({ account: testAccount }, keyIndex);
        val = 1024;
        props[metricindex] = [val, val];
        memBackend.zadd(key, timestamp, val, () =>
            assertMetrics(testAccount, props, done));
    } else if (keyIndex === 'incomingBytes' || keyIndex === 'outgoingBytes') {
        key = generateKey({ account: testAccount }, keyIndex, timestamp);
        val = 1024;
        props[metricindex] = val;
        memBackend.incrby(key, val, () =>
            assertMetrics(testAccount, props, done));
    } else {
        key = generateKey({ account: testAccount }, keyIndex, timestamp);
        val = 1;
        props = { operations: {} };
        props.operations[metricindex] = val;
        memBackend.incr(key, () => assertMetrics(testAccount, props, done));
    }
}

describe('Get Account Metrics', () => {
    afterEach(() => memBackend.flushDb());

    it('should list default (0s) metrics of an account', done =>
        assertMetrics(testAccount, null, done));

    it('should return metrics for storage utilized', done =>
        testOps('storageUtilized', 'storageUtilized', done));

    it('should return metrics for number of objects', done =>
        testOps('numberOfObjects', 'numberOfObjects', done));

    it('should return metrics for incoming bytes', done =>
        testOps('incomingBytes', 'incomingBytes', done));

    it('should return metrics for outgoing bytes', done =>
        testOps('outgoingBytes', 'outgoingBytes', done));

    it('should return metrics for delete account', done =>
        testOps('deleteBucket', 's3:DeleteBucket', done));

    it('should return metrics for list account', done =>
        testOps('listBucket', 's3:ListBucket', done));

    it('should return metrics for get account acl', done =>
        testOps('getBucketAcl', 's3:GetBucketAcl', done));

    it('should return metrics for put account acl', done =>
        testOps('putBucketAcl', 's3:PutBucketAcl', done));

    it('should return metrics for put account website', done =>
        testOps('putBucketWebsite', 's3:PutBucketWebsite', done));

    it('should return metrics for put object', done =>
        testOps('putObject', 's3:PutObject', done));

    it('should return metrics for copy object', done =>
        testOps('copyObject', 's3:CopyObject', done));

    it('should return metrics for upload part', done =>
        testOps('uploadPart', 's3:UploadPart', done));

    it('should return metrics for list account multipart uploads', done =>
        testOps('listBucketMultipartUploads', 's3:ListBucketMultipartUploads',
            done));

    it('should return metrics for list multipart upload parts', done =>
        testOps('listMultipartUploadParts', 's3:ListMultipartUploadParts',
            done));

    it('should return metrics for initiate multipart upload', done =>
        testOps('initiateMultipartUpload', 's3:InitiateMultipartUpload', done));

    it('should return metrics for complete multipart upload', done =>
        testOps('completeMultipartUpload', 's3:CompleteMultipartUpload', done));

    it('should return metrics for abort multipart upload', done =>
        testOps('abortMultipartUpload', 's3:AbortMultipartUpload', done));

    it('should return metrics for delete object', done =>
        testOps('deleteObject', 's3:DeleteObject', done));

    it('should return metrics for multiObjectDelete', done =>
        testOps('multiObjectDelete', 's3:MultiObjectDelete', done));

    it('should return metrics for get object', done =>
        testOps('getObject', 's3:GetObject', done));

    it('should return metrics for get object acl', done =>
        testOps('getObjectAcl', 's3:GetObjectAcl', done));

    it('should return metrics for put object acl', done =>
        testOps('putObjectAcl', 's3:PutObjectAcl', done));

    it('should return metrics for head account', done =>
        testOps('headBucket', 's3:HeadBucket', done));

    it('should return metrics for head object', done =>
        testOps('headObject', 's3:HeadObject', done));
});

# UTAPI CloudServer Integration

## Instructions for setup-

### 1. Prerequit packages:
* node v6.x +
* npm 3.x +
* redis server 3.2.x
* s3cmd
* awscli
* redis-cli (optional)

### 2. Setting up Zenko Cloud Server (formerly S3 server):
* Clone the cloud server:
```
git clone https://github.com/4DSB/S3 && \
cd S3 && \
git checkout 42-hackathon-utapi &&\
npm i
```

* Edit config.json file of Cloud Server and add the following lines:
```
"localCache": {
	"host": "127.0.0.1",
	"port": 6379
},
"utapi": {
	"workers": 1,
	"redis": {
		"host": "127.0.0.1",
		"port": 6379
	}
}
```
* Start the Zenko cloud server in a new terminal:
```
S3BACKEND=file npm start
```
### 3. Start the UTAPI server:
```
npm run start_utapi
```
* By default the UTAPI server runs at http://localhost:8100

### 4. Start the Redis server:
```
redis-server
```

### 5. Configure access keys for the utapiuser:
```
aws configure --profile utapiuser
```
* Example of configuration:
```
AWS Access Key ID [None]: accessKey1
AWS Secret Access Key [None]: verySecretKey1
Default region name [None]:
Default output format [None]:
```
### 6. Testing Cloud Server (s3 server):

* Create a bucket named 'utapi-bucket'
```
aws s3api create-bucket --bucket utapi-bucket --endpoint http://localhost:8000 --profile utapiuser
``` 
* Expected Output:
```
{
    "Location": "/utapi-bucket"
}
```

### 7. Copy a test file in 'utapi-bucket':
```
fallocate -l 100M file.out && \
aws s3api put-object --bucket utapi-bucket --key utapi-object --body ./tmp --endpoint http://localhost:8000 --profile utapiuser
```
* Expected Output:
```
{
    "ETag": "\"2f282b84e7e608d5852449ed940bfc51\""
}
```

### 8. Getting Storage Utilization of the UTAPI bucket:

#### The JS way:
* Create a script (custom.js) with the following code (change accessKeyID, secretAccessKey and bucketName if needed):

```
const http = require('http');
const aws4 = require('aws4');

// Input AWS access key, secret key, and session token.
const accessKeyId = 'accessKey1';
const secretAccessKey = 'verySecretKey1';
const token = '';
const bucketName = 'utapi-bucket';
// Get the start and end times for a range of one month.
const startTime = new Date(2017, 7, 1, 0, 0, 0, 0).getTime();
const endTime = new Date(2017, 9, 1, 0, 0, 0, 0).getTime() - 1;
const requestBody = JSON.stringify({
    buckets: [bucketName],
    timeRange: [startTime, endTime],
});
const header = {
    host: 'localhost',
    port: 8100,
    method: 'POST',
    service: 's3',
    path: '/buckets?Action=ListMetrics',
    signQuery: false,
    body: requestBody,
};
const credentials = { accessKeyId, secretAccessKey, token };
const options = aws4.sign(header, credentials);
const request = http.request(options, response => {
    const body = [];
    response.on('data', chunk => body.push(chunk));
    response.on('end', () => {
    const response = `${body.join('')}\n`;
    let storageUtilized;
    try {
        storageUtilized = JSON.parse(response)[0].storageUtilized;
    } catch (e) {
        process.stdout.write(`Could not parse JSON: ${e}\n`);
    }
    process.stdout.write(`[${storageUtilized[1]}]\n`);
});
});
request.on('error', e => process.stdout.write(`error: ${e.message}\n`));
request.write(requestBody);
request.end();

```
* Run the script:
```
node <path-to-js>.js
```

#### The Pythonian way
* Create a .py file with the following code: 
```
import sys, os, base64, datetime, hashlib, hmac, datetime, calendar, json
import requests # pip install requests

access_key = 'accessKey1'
secret_key = 'verySecretKey1'

method = 'POST'
service = 's3'
host = 'localhost:8100'
region = 'us-east-1'
canonical_uri = '/buckets'
canonical_querystring = 'Action=ListMetrics&Version=20160815'
content_type = 'application/x-amz-json-1.0'
algorithm = 'AWS4-HMAC-SHA256'

t = datetime.datetime.utcnow()
amz_date = t.strftime('%Y%m%dT%H%M%SZ')
date_stamp = t.strftime('%Y%m%d')

# Key derivation functions. See:
# http://docs.aws.amazon.com/general/latest/gr/signature-v4-examples.html#signature-v4-examples-python
def sign(key, msg):
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

def getSignatureKey(key, date_stamp, regionName, serviceName):
    kDate = sign(('AWS4' + key).encode('utf-8'), date_stamp)
    kRegion = sign(kDate, regionName)
    kService = sign(kRegion, serviceName)
    kSigning = sign(kService, 'aws4_request')
    return kSigning

def get_start_time(t):
    start = t.replace(minute=t.minute - t.minute % 15, second=0, microsecond=0)
    return calendar.timegm(start.utctimetuple()) * 1000;

def get_end_time(t):
    end = t.replace(minute=t.minute - t.minute % 15, second=0, microsecond=0)
    return calendar.timegm(end.utctimetuple()) * 1000 - 1;

start_time = get_start_time(datetime.datetime(2017, 6, 1, 0, 0, 0, 0))
end_time = get_end_time(datetime.datetime(2017, 9, 1, 0, 0, 0, 0))

# Request parameters for listing Utapi bucket metrics--passed in a JSON block.
bucketListing = {
    'buckets': [ 'utapi-bucket' ],
    'timeRange': [ start_time, end_time ],
}

request_parameters = json.dumps(bucketListing)

payload_hash = hashlib.sha256(request_parameters).hexdigest()

canonical_headers = \
    'content-type:{0}\nhost:{1}\nx-amz-content-sha256:{2}\nx-amz-date:{3}\n' \
    .format(content_type, host, payload_hash, amz_date)

signed_headers = 'content-type;host;x-amz-content-sha256;x-amz-date'

canonical_request = '{0}\n{1}\n{2}\n{3}\n{4}\n{5}' \
    .format(method, canonical_uri, canonical_querystring, canonical_headers,
            signed_headers, payload_hash)

credential_scope = '{0}/{1}/{2}/aws4_request' \
    .format(date_stamp, region, service)

string_to_sign = '{0}\n{1}\n{2}\n{3}' \
    .format(algorithm, amz_date, credential_scope,
            hashlib.sha256(canonical_request).hexdigest())

signing_key = getSignatureKey(secret_key, date_stamp, region, service)

signature = hmac.new(signing_key, (string_to_sign).encode('utf-8'),
                     hashlib.sha256).hexdigest()

authorization_header = \
    '{0} Credential={1}/{2}, SignedHeaders={3}, Signature={4}' \
    .format(algorithm, access_key, credential_scope, signed_headers, signature)

# The 'host' header is added automatically by the Python 'requests' library.
headers = {
    'Content-Type': content_type,
    'X-Amz-Content-Sha256': payload_hash,
    'X-Amz-Date': amz_date,
    'Authorization': authorization_header
}

endpoint = 'http://' + host + canonical_uri + '?' + canonical_querystring;

r = requests.post(endpoint, data=request_parameters, headers=headers)

s = r.text
split1 = s.rsplit('storageUtilized', 500)[1]
split2 = split1[5:].rsplit(']', 100)[0]
print (split2)
```
* Run the python file
```
python <path-to-*.py>
```

* The output is the total utilization of the bucket in bytes.

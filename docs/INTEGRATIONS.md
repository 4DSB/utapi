# UTAPI CloudServer Integration

## Instructions for setup

### 1. Required packages:
* git
```
apt-get install git
```
* redis server (stable version)
```
mkdir ~/cloudServer_scripts && \
cd ~/cloudServer_scripts && \
wget http://download.redis.io/releases/redis-4.0.1.tar.gz && \
tar xzf redis-4.0.1.tar.gz && \
cd redis-4.0.1 && \
make
```
<span style="color:green">{{ADD COMMANDS FOR EACH INSTALL}}</span>

### 2. Setting up Zenko Cloud Server (formerly S3 server):
* Clone the cloud server:
```
cd ~/ && \
git clone https://github.com/scality/S3.git && \
cd S3 && \
git checkout 42-hackathon-utapi &&\
//npm i
```

* Edit config.json file of Cloud Server and add the following lines:
```
"localCache": {
	"host": "{endpoint-url}",
	"port": 6379
},
"utapi": {
	"workers": 1,
	"redis": {
		"host": "{endpoint-url}",
		"port": 6379
	}
}
```
Note: {endpoint-url}: This would be https://<host> where your cloud server is running(usually 127.0.0.1). The host should be the same as the cloudserver host.

* Make an image from the Dockerfile in the S3 folder:
```
docker build -t cloudserver . && \
docker images
```
Upon successful built of the image, the output of docker images should have the cloudserver image along with your other images:
```
REPOSITORY          TAG                 IMAGE ID            CREATED             SIZE
cloudserver         latest              ecf4fc3a4850        14 seconds ago      296MB
node                6-slim              57264212e5c2        9 days ago          215MB
hello-world         latest              1815c82652c0        1 months ago        1.84kB
```
<span style="color:green">{{PLEASE REWRITE THIS CHUNK TO MAKE IT WORK WITH DOCKER CONTAINERS}}</span>

### 3. Run a docker container from the image:
```
docker run -d --name cloudServer -v ~/cloudServer_scripts:/usr/src/app/cloudServer_scripts  cloudserver 

```
For more options to add to the container, please refer to this [documentation link](https://github.com/scality/S3/blob/master/docs/DOCKER.rst).

<span style="color:green">{{PLEASE REWRITE THIS CHUNK TO MAKE IT WORK WITH DOCKER CONTAINERS}}</span>


### 4. Configure the container:
Open a new terminal open a bash shell to the container 
```
docker exec -it cloudServer bash
```

### 5. Start the redis :
```
cloudServer_scripts/redis-4.0.1/src/redis-server --daemonize yes
```
The server will run as a daemon.

### 6. Install awscli in the docker container:
```
apt-get update && \
apt-get install apt-file && \
apt-file update && \
apt-get install awscli

```

### 7. Configure access keys for the utapiuser:
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
For more information about User Access Configuration, please refer to [this documentation](http://s3-server.readthedocs.io/en/latest/GETTING_STARTED/#setting-your-own-access-key-and-secret-key-pairs)

<span style="color:green">{{PLEASE LINK TO S3 AND UTAPI DOC SECTIONS ABOUT USER ACCESS CONFIGURATION}}<span>

### 8. Start the UTAPI server:
```
npm run start_utapi
```
* By default the UTAPI server runs at http://localhost:8100

### 8. Testing Cloud Server (s3 server):

* Open a new terminal and open interative mode to the sdocker machine:
```
docker exec -it cloudServer bash
```
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

### 9. Copy a test file in 'utapi-bucket':
```
fallocate -l 100M file.out && \
aws s3api put-object --bucket utapi-bucket --key utapi-object --body ./file.out --endpoint http://localhost:8000 --profile utapiuser
```
* Expected Output:
```
{
    "ETag": "\"2f282b84e7e608d5852449ed940bfc51\""
}
```

### 10. Getting Storage Utilization of the UTAPI bucket:

* Create a script in the host machine in folder that has been mounted as a volume in the container.

```
cd ~/cloudServer_scripts
``` 
#### The JS way:
* Create a script (metrics.js) with the following code (change accessKeyID, secretAccessKey and bucketName if needed):

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
const endTime = new Date(2017, 10, 1, 0, 0, 0, 0).getTime() - 1;
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
    response.on('end', () => process.stdout.write(`${body.join('')}\n`));
});
request.on('error', e => process.stdout.write(`error: ${e.message}\n`));
request.write(requestBody);
request.end();

```
* Run the script from the docker container:
```
node cloudServer_scripts/metrics.js 
```
* Example of output:
```
[{"timeRange":[1501545600000,1509494399999],"storageUtilized":[0,104857600],"incomingBytes":104857600,"outgoingBytes":0,"numberOfObjects":[0,1],"operations":{"s3:DeleteBucket":0,"s3:DeleteBucketCors":0,"s3:DeleteBucketWebsite":0,"s3:DeleteObjectTagging":0,"s3:ListBucket":0,"s3:GetBucketAcl":0,"s3:GetBucketCors":0,"s3:GetBucketWebsite":0,"s3:GetBucketLocation":0,"s3:CreateBucket":2,"s3:PutBucketAcl":0,"s3:PutBucketCors":0,"s3:PutBucketWebsite":0,"s3:PutObject":2,"s3:CopyObject":0,"s3:UploadPart":0,"s3:ListBucketMultipartUploads":0,"s3:ListMultipartUploadParts":0,"s3:InitiateMultipartUpload":0,"s3:CompleteMultipartUpload":0,"s3:AbortMultipartUpload":0,"s3:DeleteObject":0,"s3:MultiObjectDelete":0,"s3:GetObject":0,"s3:GetObjectAcl":0,"s3:GetObjectTagging":0,"s3:PutObjectAcl":0,"s3:PutObjectTagging":0,"s3:HeadBucket":0,"s3:HeadObject":0,"s3:PutBucketVersioning":0,"s3:GetBucketVersioning":0,"s3:PutBucketReplication":0,"s3:GetBucketReplication":0,"s3:DeleteBucketReplication":0},"bucketName":"utapi-bucket"}]
```

#### The Pythonian way(to get storage utilized):
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

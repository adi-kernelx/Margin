
import {
    S3Client,
    CreateBucketCommand,
    PutPublicAccessBlockCommand,
    PutBucketEncryptionCommand,
    PutBucketLifecycleConfigurationCommand,
    GetBucketLocationCommand,
    BucketLocationConstraint,
    ServerSideEncryption,
    ExpirationStatus
} from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import path from 'path';

// Load environment from ../../.env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const region = process.env.AWS_REGION || 'us-east-1';
const bucketName = process.env.S3_BUCKET;

if (!bucketName) {
    console.error('Error: S3_BUCKET environment variable is not defined.');
    process.exit(1);
}

const s3 = new S3Client({
    region,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
    }
});

async function main() {
    console.log(`[Init-S3] Configuring bucket: ${bucketName} in ${region}`);

    // 1. Create Bucket (if it doesn't exist)
    try {
        await s3.send(new GetBucketLocationCommand({ Bucket: bucketName }));
        console.log('✅ Bucket already exists.');
    } catch (err: any) {
        if (err.name === 'NoSuchBucket' || err.name === 'NotFound') {
            console.log('Bucket not found. Creating...');
            try {
                await s3.send(new CreateBucketCommand({
                    Bucket: bucketName,
                    // Constraint is required if not us-east-1
                    CreateBucketConfiguration: region !== 'us-east-1' ? {
                        LocationConstraint: region as BucketLocationConstraint
                    } : undefined
                }));
                console.log('✅ Bucket created.');
            } catch (createErr) {
                console.error('Failed to create bucket:', createErr);
                process.exit(1);
            }
        } else {
            console.error('Error checking bucket:', err);
            // Assuming we check permissions or connection
            process.exit(1);
        }
    }

    // 2. Block Public Access
    try {
        await s3.send(new PutPublicAccessBlockCommand({
            Bucket: bucketName,
            PublicAccessBlockConfiguration: {
                BlockPublicAcls: true,
                IgnorePublicAcls: true,
                BlockPublicPolicy: true,
                RestrictPublicBuckets: true
            }
        }));
        console.log('✅ Public access blocked.');
    } catch (err) {
        console.warn('⚠️  Failed to set public access block (might expect permissions):', err);
    }

    // 3. Default Encryption (SSE-S3)
    try {
        await s3.send(new PutBucketEncryptionCommand({
            Bucket: bucketName,
            ServerSideEncryptionConfiguration: {
                Rules: [
                    {
                        ApplyServerSideEncryptionByDefault: {
                            SSEAlgorithm: 'AES256'
                        },
                        BucketKeyEnabled: true
                    }
                ]
            }
        }));
        console.log('✅ Default encryption (SSE-S3) enabled.');
    } catch (err) {
        console.warn('⚠️  Failed to set bucket encryption:', err);
    }

    // 4. Lifecycle Rules
    // Move "page images" to IA (Infrequent Access) after 14 days
    // We will assume page images are tagged with { "type": "page-image" }
    // or we can rely on file extension logic if wildcards were supported (they aren't)
    // So we use Filter with Tag.
    try {
        await s3.send(new PutBucketLifecycleConfigurationCommand({
            Bucket: bucketName,
            LifecycleConfiguration: {
                Rules: [
                    {
                        ID: 'MovePageImagesToIA',
                        Status: 'Enabled',
                        Filter: {
                            Tag: {
                                Key: 'lifecycle-type',
                                Value: 'page-image'
                            }
                        },
                        Transitions: [
                            {
                                Days: 14,
                                StorageClass: 'STANDARD_IA'
                            }
                        ]
                    }
                ]
            }
        }));
        console.log('✅ Lifecycle rules configured (Transition tagged objects to IA).');
    } catch (err) {
        console.warn('⚠️  Failed to set lifecycle configuration:', err);
    }

    console.log('\n--- Configuration Complete ---');
    console.log('Note: To ensure IAM-only access, verify your user/role policies.');
    console.log('Remember to tag page images with "lifecycle-type=page-image" on upload.');
}

main();

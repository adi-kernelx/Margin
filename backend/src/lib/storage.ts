import express from 'express';
import dotenv from 'dotenv';
import { S3Client } from '@aws-sdk/client-s3';
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

dotenv.config();

// Ensure Types
declare global {
    namespace Express {
        interface Request {
            user?: { uid: string; email?: string };
        }
    }
}

// Configs
export const S3_BUCKET = process.env.S3_BUCKET!;
export const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
export const S3_SIGNED_URL_EXP = parseInt(process.env.S3_SIGNED_URL_EXP || '300');

// Initialize Firestore
let serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (serviceAccountPath && serviceAccountPath.startsWith('"') && serviceAccountPath.endsWith('"')) {
    serviceAccountPath = serviceAccountPath.slice(1, -1);
}

if (!serviceAccountPath || !fs.existsSync(serviceAccountPath)) {
    console.warn('WARNING: GOOGLE_APPLICATION_CREDENTIALS not found or invalid.');
} else {
    // If not already initialized
    if (admin.apps.length === 0) {
        try {
            const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                projectId: serviceAccount.project_id
            });
            console.log(`Firestore initialized: ${serviceAccount.project_id}`);
        } catch (err) {
            console.error('Failed to load service account json:', err);
        }
    }
}

export const firestore = admin.firestore();

// Initialize S3
export const s3 = new S3Client({
    region: AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
    }
});

// Initialize SQS
import { SQSClient } from '@aws-sdk/client-sqs';
export const sqs = new SQSClient({
    region: AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
    }
});

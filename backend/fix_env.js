const fs = require('fs');
const path = require('path');

const envContent = `GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
PORT=4000
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=AKIAXQGLTVA34FUMNSNH
AWS_SECRET_ACCESS_KEY=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
S3_BUCKET=pdf-reader-uploads-aditya
S3_SIGNED_URL_EXP=300
`;

fs.writeFileSync(path.join(__dirname, '.env'), envContent, { encoding: 'utf8' });
console.log('.env fixed with UTF-8');

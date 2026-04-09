import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

const REGION = process.env.AWS_REGION || 'us-east-2';

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: pnpm upload-audio <file.mp3> <reminder-name>');
    console.error('Example: pnpm upload-audio ./recordings/remedio-manha.mp3 morning-medication');
    process.exit(1);
  }

  const [filePath, reminderName] = args;

  // Validate file exists
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exit(1);
  }

  // Validate MP3 format
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.mp3') {
    console.error(`❌ File must be MP3 format, got: ${ext}`);
    process.exit(1);
  }

  // Normalize audio loudness to match Alexa TTS level (~-14 LUFS)
  let normalizedPath: string | null = null;
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    normalizedPath = filePath.replace(/\.mp3$/, '.normalized.mp3');
    console.log('🔊 Normalizing audio loudness...');
    execSync(
      `ffmpeg -y -i "${filePath}" ` +
      `-af "acompressor=threshold=-20dB:ratio=4:attack=5:release=50:makeup=8,alimiter=limit=0.95:level=false" ` +
      `-ar 48000 -b:a 128k "${normalizedPath}"`,
      { stdio: 'pipe' }
    );
    console.log('   ✅ Audio normalized to ~-14 LUFS');
  } catch {
    console.warn('⚠️  ffmpeg not available — uploading without normalization');
    normalizedPath = null;
  }

  const uploadPath = normalizedPath && fs.existsSync(normalizedPath) ? normalizedPath : filePath;
  const fileBuffer = fs.readFileSync(uploadPath);
  const fileSizeKB = Math.round(fileBuffer.length / 1024);

  // Warn if file is likely longer than 90 seconds (rough estimate: 48kbps = 6KB/s)
  const estimatedSeconds = Math.round(fileBuffer.length / 6000);
  if (estimatedSeconds > 90) {
    console.warn(`⚠️  Warning: Audio file appears to be ~${estimatedSeconds}s long (>90s recommended limit for Alexa)`);
  }

  // Get bucket name from SSM or env
  const bucketName = process.env.PUDDING_AUDIO_BUCKET;
  if (!bucketName) {
    console.error('❌ Set PUDDING_AUDIO_BUCKET environment variable (e.g., pudding-audio-123456789)');
    process.exit(1);
  }

  const uuid = crypto.randomUUID();
  const fileName = path.basename(filePath);
  const key = `audio/${reminderName}/${uuid}-${fileName}`;

  const s3 = new S3Client({ region: REGION });

  console.log(`📤 Uploading ${fileName} (${fileSizeKB}KB) to s3://${bucketName}/${key}`);

  await s3.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: fileBuffer,
    ContentType: 'audio/mpeg',
  }));

  // Clean up temp normalized file
  if (normalizedPath && fs.existsSync(normalizedPath)) {
    fs.unlinkSync(normalizedPath);
  }

  const publicUrl = `https://${bucketName}.s3.${REGION}.amazonaws.com/${key}`;
  console.log(`✅ Upload complete!`);
  console.log(`🔗 Audio URL: ${publicUrl}`);
  console.log(`\nUse this URL as the audioUrl in your reminder config.`);
}

main().catch((err) => {
  console.error('❌ Upload failed:', err.message);
  process.exit(1);
});

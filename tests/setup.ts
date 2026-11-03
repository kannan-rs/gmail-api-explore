import 'dotenv/config';

const live = process.env.RUN_LIVE_GMAIL_TESTS === '1';

process.env.NODE_ENV = live ? 'development' : 'test';
process.env.LOG_LEVEL = 'silent';

if (!live) {
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ?? 'postgresql://localhost:5432/gmail_send_tracker_test';
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  process.env.COOKIE_SECRET = 'test-cookie-secret';
  process.env.DAILY_SEND_LIMIT = '1000';
  process.env.MAX_ATTACHMENT_BYTES = '20971520';
  process.env.MAX_ATTACHMENTS = '10';
  process.env.GOOGLE_CLIENT_ID = '';
  process.env.GOOGLE_CLIENT_SECRET = '';
  process.env.TRACKING_ENABLED = 'true';
  process.env.TRACKING_PIXEL_ENABLED = 'true';
  process.env.TRACKING_ACK_ENABLED = 'true';
  process.env.READ_RECEIPT_REQUESTED = 'true';
  process.env.TRACKING_WEBHOOK_SECRET = '';
  process.env.TRACKING_SYNC_DAYS = '7';
}

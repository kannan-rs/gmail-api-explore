import type { AppConfig } from '../config';
import type { Database } from '../db/client';
import type { GmailOAuthService } from '../providers/gmail/oauth';
import type { ClientRepository } from '../repositories/client-repository';
import type { MailboxRepository } from '../repositories/mailbox-repository';
import type { SendRepository } from '../repositories/send-repository';
import type { TrackingRepository } from '../repositories/tracking-repository';
import type { CredentialService } from '../services/credential-service';
import type { SendService } from '../services/send-service';
import type { TrackingService } from '../services/tracking-service';
import type { VerificationService } from '../services/verification-service';

export interface AppContext {
  config: AppConfig;
  db: Database;
  clients: ClientRepository;
  mailboxes: MailboxRepository;
  sends: SendRepository;
  tracking: TrackingRepository;
  credentials: CredentialService;
  sendService: SendService;
  verificationService: VerificationService;
  trackingService: TrackingService;
  oauth: GmailOAuthService;
}

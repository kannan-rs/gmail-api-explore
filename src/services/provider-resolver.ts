import type { EmailProvider } from '../providers/email-provider';
import type { MailboxConnection } from './credential-service';

export type ProviderResolver = (connection: MailboxConnection) => EmailProvider;

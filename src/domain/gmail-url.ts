export function buildGmailSentUrl(mailboxEmail: string, providerMessageId: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(
    mailboxEmail,
  )}#sent/${encodeURIComponent(providerMessageId)}`;
}

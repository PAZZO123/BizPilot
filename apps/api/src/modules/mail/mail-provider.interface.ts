export interface SendMailRequest {
  to: string;
  subject: string;
  /** Plain-text body. Every mail must read fine without HTML. */
  text: string;
  /** Optional HTML alternative rendered by clients that support it. */
  html?: string;
}

/**
 * Every mail gateway looks the same from the app's side — the same rule as
 * SMS providers. Swapping Resend for anything else should be an env var, not
 * a code change.
 */
export interface MailProvider {
  readonly name: string;
  send(request: SendMailRequest): Promise<void>;
}

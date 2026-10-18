// Google accounts connected for reading statements from Gmail. Shared by main and renderer.

export type MailJob = 'CAS' | 'STATEMENT' | 'REPORT'

/** One statement found in the mail and what happened to it. */
export interface MailFound {
  at: string
  job: MailJob
  subject: string
  /** When the email arrived. */
  received: string
  result: 'IMPORTED' | 'FAILED'
  message: string
}

/** An email found by a search, for Ask your money. */
export interface MailHit {
  /** The connected mailbox it is in. */
  account: string
  /** Whose mailbox that is. */
  person: string
  id: string
  /** Received, YYYY-MM-DD. */
  date: string
  from: string
  subject: string
  snippet: string
  attachments: string[]
}

export interface GoogleAccountView {
  email: string
  /** Whose statements arrive in this mailbox. */
  personId: number
  personName: string
  addedAt: string
  lastCheck: string | null
  status: 'OK' | 'NEVER' | 'RECONNECT' | 'ERROR'
  message: string | null
  recent: MailFound[]
}

export interface GoogleSetup {
  /** The person's own OAuth client (from Google Cloud) has been entered. */
  configured: boolean
  /** Last characters of the client ID, to recognise it. */
  clientIdEnding: string | null
  /** A "Web application" client, which the phone app can sign in with too. */
  webClient: boolean
  accounts: GoogleAccountView[]
}

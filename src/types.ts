export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type GitErrorCode =
  | "auth"
  | "conflict"
  | "dirty_worktree"
  | "not_found"
  | "non_fast_forward"
  | "rate_limited"
  | "cancelled"
  | "unsupported"
  | "invalid_argument"
  | "unknown";

export interface CommandOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface RepositoryInfo {
  root: string;
  branch: string | null;
  head: string | null;
  bare: boolean;
}

export type ChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "conflicted";

export interface FileChange {
  path: string;
  previousPath?: string;
  index: ChangeKind | null;
  worktree: ChangeKind | null;
}

export interface WorkingTreeStatus {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: FileChange[];
  clean: boolean;
}

export interface Commit {
  id: string;
  shortId: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  subject: string;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
  total?: number;
}

export interface LogQuery extends CommandOptions {
  ref?: string;
  limit?: number;
  skip?: number;
}

export interface DiffQuery extends CommandOptions {
  from?: string;
  to?: string;
  staged?: boolean;
  paths?: string[];
}

export interface Diff {
  patch: string;
  files: string[];
}

export interface Branch {
  name: string;
  current: boolean;
  remote: boolean;
  target: string;
  upstream?: string;
}

export interface OperationProposal {
  operation: string;
  arguments: Record<string, JsonValue>;
  summary: string;
}

export type PendingMode = "apply" | "propose";

export interface MutationOptions extends CommandOptions {
  pendingMode?: PendingMode;
}

export interface GitRemote {
  name: string;
  fetchUrl: string;
  pushUrl?: string;
}

export type ProviderKind = "github" | "gitlab" | "bitbucket";

export interface ProviderRepositoryRef {
  provider: ProviderKind;
  owner: string;
  name: string;
  baseUrl?: string;
}

export interface HostedRepository extends ProviderRepositoryRef {
  id: string;
  webUrl: string;
  defaultBranch: string;
  private: boolean;
  description?: string;
}

export type ReviewState = "open" | "merged" | "closed" | "draft";

export interface Review {
  id: string;
  number: number;
  title: string;
  state: ReviewState;
  webUrl: string;
  sourceBranch: string;
  targetBranch: string;
  author: string;
  extensions?: Record<string, JsonValue>;
}

export interface ReviewDetails extends Review {
  body?: string;
  mergeable?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReviewInput {
  title: string;
  body?: string;
  sourceBranch: string;
  targetBranch: string;
  draft?: boolean;
}

export interface ReviewQuery {
  state?: ReviewState;
  cursor?: string;
  limit?: number;
}

export interface Comparison {
  aheadBy: number;
  behindBy: number;
  commits: Commit[];
  patchUrl?: string;
}

export type CheckState =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "cancelled"
  | "skipped"
  | "unknown";

export interface CheckSummary {
  id: string;
  name: string;
  state: CheckState;
  webUrl?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface GitProvider {
  readonly kind: ProviderKind;
  identify(remote: GitRemote): ProviderRepositoryRef | null;
  repository(ref: ProviderRepositoryRef): Promise<HostedRepository>;
  listReviews(
    ref: ProviderRepositoryRef,
    query?: ReviewQuery,
  ): Promise<Page<Review>>;
  getReview(
    ref: ProviderRepositoryRef,
    number: number,
  ): Promise<ReviewDetails>;
  createReview(
    ref: ProviderRepositoryRef,
    input: CreateReviewInput,
  ): Promise<Review>;
  compare(
    ref: ProviderRepositoryRef,
    base: string,
    head: string,
  ): Promise<Comparison>;
  checks(
    ref: ProviderRepositoryRef,
    revision: string,
  ): Promise<CheckSummary[]>;
}

export type IssueState = "open" | "closed";

/**
 * A tracked issue, normalized across hosts.
 *
 * Deliberately thinner than each host's own model. GitHub has milestones and
 * state reasons, GitLab has weights and epics, Bitbucket has kinds and
 * priorities — none of which survive a move between them. What every host
 * agrees on lives here; the rest goes in `extensions`, where a consumer that
 * knows its host can reach it without the contract pretending it is portable.
 */
export interface Issue {
  id: string;
  number: number;
  title: string;
  state: IssueState;
  webUrl: string;
  author: string;
  labels: string[];
  assignees: string[];
  createdAt: string;
  updatedAt: string;
  extensions?: Record<string, JsonValue>;
}

export interface IssueDetails extends Issue {
  body?: string;
  closedAt?: string;
  commentCount?: number;
}

export interface CreateIssueInput {
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
}

/**
 * A partial update. Every field is optional and only the ones present are sent
 * — an update that echoed the whole issue back would clobber a field somebody
 * else changed between the read and the write.
 */
export interface UpdateIssueInput {
  title?: string;
  body?: string;
  state?: IssueState;
  labels?: string[];
  assignees?: string[];
}

export interface IssueQuery {
  state?: IssueState;
  labels?: string[];
  assignee?: string;
  /** Free-text search over title and body, where the host supports it. */
  search?: string;
  cursor?: string;
  limit?: number;
}

/**
 * Issue tracking, as a SEPARATE contract from {@link GitProvider}.
 *
 * Not added to `GitProvider` on purpose: that interface is implemented by every
 * provider, including ones outside this suite, and adding a method to it would
 * break each of them at compile time for a capability many hosts do not offer.
 * A self-hosted Git remote with no tracker is a perfectly good `GitProvider`.
 *
 * So an adapter opts in, and a caller asks {@link supportsIssues} before
 * reaching for these — the same shape the rest of the suite uses for optional
 * capability.
 */
export interface IssueProvider {
  listIssues(ref: ProviderRepositoryRef, query?: IssueQuery): Promise<Page<Issue>>;
  getIssue(ref: ProviderRepositoryRef, number: number): Promise<IssueDetails>;
  createIssue(ref: ProviderRepositoryRef, input: CreateIssueInput): Promise<Issue>;
  updateIssue(
    ref: ProviderRepositoryRef,
    number: number,
    input: UpdateIssueInput,
  ): Promise<Issue>;
  commentOnIssue(
    ref: ProviderRepositoryRef,
    number: number,
    body: string,
  ): Promise<{ id: string; webUrl: string }>;
}

/**
 * Whether a provider tracks issues.
 *
 * Checks one method rather than all five: an adapter implementing half of
 * `IssueProvider` is a bug in that adapter, not a state this guard should try to
 * describe. Callers get a typed provider or a clear "this host has no tracker".
 */
export function supportsIssues(
  provider: GitProvider,
): provider is GitProvider & IssueProvider {
  return typeof (provider as Partial<IssueProvider>).createIssue === "function";
}

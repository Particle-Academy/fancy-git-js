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

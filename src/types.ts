export type ReviewScope = "git-diff" | "last-commit" | "base-branch" | "all-files";

export type BaseReviewMode = "full" | "patch" | "cumulative";

export type ChangeStatus = "modified" | "added" | "deleted" | "renamed";

export interface ReviewFileComparison {
  status: ChangeStatus;
  oldPath: string | null;
  newPath: string | null;
  displayPath: string;
  hasOriginal: boolean;
  hasModified: boolean;
}

export interface ReviewFileCommitComparisons {
  patch: ReviewFileComparison | null;
  cumulative: ReviewFileComparison | null;
}

export interface ReviewFile {
  id: string;
  path: string;
  worktreeStatus: ChangeStatus | null;
  hasWorkingTreeFile: boolean;
  inGitDiff: boolean;
  inLastCommit: boolean;
  inBaseBranch: boolean;
  gitDiff: ReviewFileComparison | null;
  lastCommit: ReviewFileComparison | null;
  baseBranch: ReviewFileComparison | null;
  commitComparisons: Record<string, ReviewFileCommitComparisons>;
}

export interface ReviewFileContents {
  originalContent: string;
  modifiedContent: string;
}

export interface ReviewCommit {
  id: string;
  shortId: string;
  title: string;
  parentCount: number;
}

export interface ReviewBaseBranchData {
  baseRef: string;
  mergeBase: string;
  commits: ReviewCommit[];
}

export type CommentSide = "original" | "modified" | "file";

export interface DiffReviewComment {
  id: string;
  fileId: string;
  scope: ReviewScope;
  baseMode?: BaseReviewMode | null;
  commitId?: string | null;
  side: CommentSide;
  startLine: number | null;
  endLine: number | null;
  body: string;
}

export interface ReviewSubmitPayload {
  type: "submit";
  overallComment: string;
  comments: DiffReviewComment[];
}

export interface ReviewCancelPayload {
  type: "cancel";
}

export interface ReviewRequestFilePayload {
  type: "request-file";
  requestId: string;
  fileId: string;
  scope: ReviewScope;
  baseMode?: BaseReviewMode | null;
  commitId?: string | null;
}

export type ReviewWindowMessage = ReviewSubmitPayload | ReviewCancelPayload | ReviewRequestFilePayload;

export interface ReviewFileDataMessage {
  type: "file-data";
  requestId: string;
  fileId: string;
  scope: ReviewScope;
  baseMode?: BaseReviewMode | null;
  commitId?: string | null;
  originalContent: string;
  modifiedContent: string;
}

export interface ReviewFileErrorMessage {
  type: "file-error";
  requestId: string;
  fileId: string;
  scope: ReviewScope;
  baseMode?: BaseReviewMode | null;
  commitId?: string | null;
  message: string;
}

export type ReviewHostMessage = ReviewFileDataMessage | ReviewFileErrorMessage;

export interface ReviewWindowData {
  repoRoot: string;
  files: ReviewFile[];
  baseBranch: ReviewBaseBranchData | null;
}

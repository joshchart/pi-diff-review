import type {
  BaseReviewMode,
  DiffReviewComment,
  ReviewCommit,
  ReviewFile,
  ReviewScope,
  ReviewSubmitPayload,
  ReviewWindowData,
} from "./types.js";

function findBaseCommit(commits: ReviewCommit[], commitId: string | null | undefined): ReviewCommit | undefined {
  if (commitId == null) return undefined;
  return commits.find((commit) => commit.id === commitId);
}

function formatScopeLabel(scope: ReviewScope, comment: DiffReviewComment, data: ReviewWindowData): string {
  switch (scope) {
    case "git-diff":
      return "git diff";
    case "last-commit":
      return "last commit";
    case "base-branch": {
      const baseRef = data.baseBranch?.baseRef ?? "base branch";
      const mode: BaseReviewMode = comment.baseMode ?? "full";
      if (mode === "full") return `pr diff vs ${baseRef}`;
      const commit = findBaseCommit(data.baseBranch?.commits ?? [], comment.commitId);
      const commitLabel = commit == null ? "selected commit" : `${commit.shortId} ${commit.title}`;
      return mode === "patch"
        ? `commit patch ${commitLabel}`
        : `cumulative to ${commitLabel}`;
    }
    default:
      return "all files";
  }
}

function getCommentFilePath(file: ReviewFile | undefined, comment: DiffReviewComment): string {
  if (file == null) return "(unknown file)";

  let comparison = null;
  if (comment.scope === "git-diff") comparison = file.gitDiff;
  else if (comment.scope === "last-commit") comparison = file.lastCommit;
  else if (comment.scope === "base-branch") {
    const mode = comment.baseMode ?? "full";
    if (mode === "full") comparison = file.baseBranch;
    else if (comment.commitId != null) comparison = file.commitComparisons[comment.commitId]?.[mode] ?? null;
  }

  return comparison?.displayPath ?? file.path;
}

function formatLocation(comment: DiffReviewComment, file: ReviewFile | undefined, data: ReviewWindowData): string {
  const filePath = getCommentFilePath(file, comment);
  const scopePrefix = `[${formatScopeLabel(comment.scope, comment, data)}] `;

  if (comment.side === "file" || comment.startLine == null) {
    return `${scopePrefix}${filePath}`;
  }

  const range = comment.endLine != null && comment.endLine !== comment.startLine
    ? `${comment.startLine}-${comment.endLine}`
    : `${comment.startLine}`;

  if (comment.scope === "all-files") {
    return `${scopePrefix}${filePath}:${range}`;
  }

  const suffix = comment.side === "original" ? " (old)" : " (new)";
  return `${scopePrefix}${filePath}:${range}${suffix}`;
}

export function composeReviewPrompt(data: ReviewWindowData, payload: ReviewSubmitPayload): string {
  const fileMap = new Map(data.files.map((file) => [file.id, file]));
  const lines: string[] = [];

  lines.push("Please address the following feedback");
  lines.push("");

  const overallComment = payload.overallComment.trim();
  if (overallComment.length > 0) {
    lines.push(overallComment);
    lines.push("");
  }

  payload.comments.forEach((comment, index) => {
    const file = fileMap.get(comment.fileId);
    lines.push(`${index + 1}. ${formatLocation(comment, file, data)}`);
    lines.push(`   ${comment.body.trim()}`);
    lines.push("");
  });

  return lines.join("\n").trim();
}

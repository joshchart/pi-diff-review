import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type {
  BaseReviewMode,
  ChangeStatus,
  ReviewBaseBranchData,
  ReviewCommit,
  ReviewFile,
  ReviewFileComparison,
  ReviewFileCommitComparisons,
  ReviewFileContents,
  ReviewScope,
} from "./types.js";

interface ChangedPath {
  status: ChangeStatus;
  oldPath: string | null;
  newPath: string | null;
}

interface ReviewFileSeed {
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

async function runGit(pi: ExtensionAPI, repoRoot: string, args: string[]): Promise<string> {
  const result = await pi.exec("git", args, { cwd: repoRoot });
  if (result.code !== 0) {
    const message = result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`;
    throw new Error(message);
  }
  return result.stdout;
}

async function runGitAllowFailure(pi: ExtensionAPI, repoRoot: string, args: string[]): Promise<string> {
  const result = await pi.exec("git", args, { cwd: repoRoot });
  if (result.code !== 0) {
    return "";
  }
  return result.stdout;
}

export async function getRepoRoot(pi: ExtensionAPI, cwd: string): Promise<string> {
  const result = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd });
  if (result.code !== 0) {
    throw new Error("Not inside a git repository.");
  }
  return result.stdout.trim();
}

async function hasHead(pi: ExtensionAPI, repoRoot: string): Promise<boolean> {
  const result = await pi.exec("git", ["rev-parse", "--verify", "HEAD"], { cwd: repoRoot });
  return result.code === 0;
}

async function refExists(pi: ExtensionAPI, repoRoot: string, ref: string): Promise<boolean> {
  const result = await pi.exec("git", ["rev-parse", "--verify", "--quiet", ref], { cwd: repoRoot });
  return result.code === 0;
}

function parseNameStatus(output: string): ChangedPath[] {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const changes: ChangedPath[] = [];

  for (const line of lines) {
    const parts = line.split("\t");
    const rawStatus = parts[0] ?? "";
    const code = rawStatus[0];

    if (code === "R") {
      const oldPath = parts[1] ?? null;
      const newPath = parts[2] ?? null;
      if (oldPath != null && newPath != null) {
        changes.push({ status: "renamed", oldPath, newPath });
      }
      continue;
    }

    if (code === "M") {
      const path = parts[1] ?? null;
      if (path != null) {
        changes.push({ status: "modified", oldPath: path, newPath: path });
      }
      continue;
    }

    if (code === "A") {
      const path = parts[1] ?? null;
      if (path != null) {
        changes.push({ status: "added", oldPath: null, newPath: path });
      }
      continue;
    }

    if (code === "D") {
      const path = parts[1] ?? null;
      if (path != null) {
        changes.push({ status: "deleted", oldPath: path, newPath: null });
      }
    }
  }

  return changes;
}

function parseUntrackedPaths(output: string): ChangedPath[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((path) => ({
      status: "added" as const,
      oldPath: null,
      newPath: path,
    }));
}

function parseTrackedPaths(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseCommitLog(output: string): ReviewCommit[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [id = "", shortId = "", parentIds = "", ...titleParts] = line.split("\t");
      const parentCount = parentIds.trim().length === 0
        ? 0
        : parentIds.trim().split(/\s+/).length;

      return {
        id,
        shortId: shortId || id.slice(0, 7),
        title: titleParts.join("\t") || shortId || id.slice(0, 7),
        parentCount,
      };
    })
    .filter((commit) => commit.id.length > 0);
}

function mergeChangedPaths(tracked: ChangedPath[], untracked: ChangedPath[]): ChangedPath[] {
  const seen = new Set(tracked.map((change) => `${change.status}:${change.oldPath ?? ""}:${change.newPath ?? ""}`));
  const merged = [...tracked];

  for (const change of untracked) {
    const key = `${change.status}:${change.oldPath ?? ""}:${change.newPath ?? ""}`;
    if (seen.has(key)) continue;
    merged.push(change);
    seen.add(key);
  }

  return merged;
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

function toDisplayPath(change: ChangedPath): string {
  if (change.status === "renamed") {
    return `${change.oldPath ?? ""} -> ${change.newPath ?? ""}`;
  }
  return change.newPath ?? change.oldPath ?? "(unknown)";
}

function toComparison(change: ChangedPath): ReviewFileComparison {
  return {
    status: change.status,
    oldPath: change.oldPath,
    newPath: change.newPath,
    displayPath: toDisplayPath(change),
    hasOriginal: change.oldPath != null,
    hasModified: change.newPath != null,
  };
}

function buildReviewFileId(seed: ReviewFileSeed): string {
  return [
    seed.path,
    seed.hasWorkingTreeFile ? "working" : "gone",
    seed.gitDiff?.displayPath ?? "",
    seed.lastCommit?.displayPath ?? "",
    seed.baseBranch?.displayPath ?? "",
  ].join("::");
}

function createReviewFile(seed: ReviewFileSeed): ReviewFile {
  return {
    id: buildReviewFileId(seed),
    path: seed.path,
    worktreeStatus: seed.worktreeStatus,
    hasWorkingTreeFile: seed.hasWorkingTreeFile,
    inGitDiff: seed.inGitDiff,
    inLastCommit: seed.inLastCommit,
    inBaseBranch: seed.inBaseBranch,
    gitDiff: seed.gitDiff,
    lastCommit: seed.lastCommit,
    baseBranch: seed.baseBranch,
    commitComparisons: seed.commitComparisons,
  };
}

async function getRevisionContent(pi: ExtensionAPI, repoRoot: string, revision: string, path: string): Promise<string> {
  const result = await pi.exec("git", ["show", `${revision}:${path}`], { cwd: repoRoot });
  if (result.code !== 0) {
    return "";
  }
  return result.stdout;
}

async function getWorkingTreeContent(repoRoot: string, path: string): Promise<string> {
  try {
    return await readFile(join(repoRoot, path), "utf8");
  } catch {
    return "";
  }
}

function isReviewableFilePath(path: string): boolean {
  const lowerPath = path.toLowerCase();
  const fileName = lowerPath.split("/").pop() ?? lowerPath;
  const extension = extname(fileName);

  if (fileName.length === 0) return false;

  const binaryExtensions = new Set([
    ".7z",
    ".a",
    ".avi",
    ".avif",
    ".bin",
    ".bmp",
    ".class",
    ".dll",
    ".dylib",
    ".eot",
    ".exe",
    ".gif",
    ".gz",
    ".ico",
    ".jar",
    ".jpeg",
    ".jpg",
    ".lockb",
    ".map",
    ".mov",
    ".mp3",
    ".mp4",
    ".o",
    ".otf",
    ".pdf",
    ".png",
    ".pyc",
    ".so",
    ".svgz",
    ".tar",
    ".ttf",
    ".wasm",
    ".webm",
    ".webp",
    ".woff",
    ".woff2",
    ".zip",
  ]);

  if (binaryExtensions.has(extension)) return false;
  if (fileName.endsWith(".min.js") || fileName.endsWith(".min.css")) return false;

  return true;
}

function compareReviewFiles(a: ReviewFile, b: ReviewFile): number {
  return a.path.localeCompare(b.path);
}

function createSeed(path: string, hasWorkingTreeFile: boolean): ReviewFileSeed {
  return {
    path,
    worktreeStatus: null,
    hasWorkingTreeFile,
    inGitDiff: false,
    inLastCommit: false,
    inBaseBranch: false,
    gitDiff: null,
    lastCommit: null,
    baseBranch: null,
    commitComparisons: {},
  };
}

function upsertSeed(seeds: Map<string, ReviewFileSeed>, key: string, create: () => ReviewFileSeed): ReviewFileSeed {
  const existing = seeds.get(key);
  if (existing != null) return existing;
  const seed = create();
  seeds.set(key, seed);
  return seed;
}

function filterReviewableChanges(changes: ChangedPath[]): ChangedPath[] {
  return changes.filter((change) => isReviewableFilePath(change.newPath ?? change.oldPath ?? ""));
}

function resolveSeedKey(change: ChangedPath): string {
  return change.newPath ?? change.oldPath ?? toDisplayPath(change);
}

async function resolveDefaultBaseRef(pi: ExtensionAPI, repoRoot: string): Promise<string | null> {
  const originHead = (await runGitAllowFailure(pi, repoRoot, ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"]))
    .trim();
  const candidates = uniquePaths([
    originHead,
    "origin/main",
    "origin/master",
    "main",
    "master",
  ].filter((value) => value.length > 0));

  for (const candidate of candidates) {
    if (await refExists(pi, repoRoot, candidate)) return candidate;
  }

  return null;
}

async function resolveBaseBranchData(
  pi: ExtensionAPI,
  repoRoot: string,
  explicitBaseRef: string | null,
): Promise<ReviewBaseBranchData | null> {
  const providedBaseRef = explicitBaseRef?.trim() ?? "";
  const baseRef = providedBaseRef.length > 0
    ? providedBaseRef
    : await resolveDefaultBaseRef(pi, repoRoot);

  if (baseRef == null) return null;
  if (!await refExists(pi, repoRoot, baseRef)) {
    throw new Error(`Base ref not found: ${baseRef}`);
  }

  const mergeBase = (await runGitAllowFailure(pi, repoRoot, ["merge-base", "HEAD", baseRef])).trim();
  if (mergeBase.length === 0) {
    if (providedBaseRef.length > 0) {
      throw new Error(`No merge base found between HEAD and ${baseRef}.`);
    }
    return null;
  }

  const commitsOutput = await runGitAllowFailure(pi, repoRoot, ["log", "--reverse", "--format=%H%x09%h%x09%P%x09%s", `${mergeBase}..HEAD`]);
  return {
    baseRef,
    mergeBase,
    commits: parseCommitLog(commitsOutput),
  };
}

async function getCommitPatchChanges(pi: ExtensionAPI, repoRoot: string, commit: ReviewCommit): Promise<ChangedPath[]> {
  const output = commit.parentCount === 0
    ? await runGitAllowFailure(pi, repoRoot, [
      "diff-tree",
      "--root",
      "--find-renames",
      "-M",
      "--name-status",
      "--no-commit-id",
      "-r",
      commit.id,
    ])
    : await runGitAllowFailure(pi, repoRoot, ["diff", "--find-renames", "-M", "--name-status", `${commit.id}^..${commit.id}`, "--"]);
  return filterReviewableChanges(parseNameStatus(output));
}

async function getCommitCumulativeChanges(
  pi: ExtensionAPI,
  repoRoot: string,
  mergeBase: string,
  commitId: string,
): Promise<ChangedPath[]> {
  const output = await runGitAllowFailure(pi, repoRoot, ["diff", "--find-renames", "-M", "--name-status", `${mergeBase}..${commitId}`, "--"]);
  return filterReviewableChanges(parseNameStatus(output));
}

export async function getReviewWindowData(
  pi: ExtensionAPI,
  cwd: string,
  options: { baseRef?: string | null } = {},
): Promise<{ repoRoot: string; files: ReviewFile[]; baseBranch: ReviewBaseBranchData | null }> {
  const repoRoot = await getRepoRoot(pi, cwd);
  const repositoryHasHead = await hasHead(pi, repoRoot);

  const trackedDiffOutput = repositoryHasHead
    ? await runGit(pi, repoRoot, ["diff", "--find-renames", "-M", "--name-status", "HEAD", "--"])
    : "";
  const untrackedOutput = await runGitAllowFailure(pi, repoRoot, ["ls-files", "--others", "--exclude-standard"]);
  const trackedFilesOutput = await runGitAllowFailure(pi, repoRoot, ["ls-files", "--cached"]);
  const deletedFilesOutput = await runGitAllowFailure(pi, repoRoot, ["ls-files", "--deleted"]);
  const lastCommitOutput = repositoryHasHead
    ? await runGitAllowFailure(pi, repoRoot, ["diff-tree", "--root", "--find-renames", "-M", "--name-status", "--no-commit-id", "-r", "HEAD"])
    : "";

  const baseBranch = repositoryHasHead
    ? await resolveBaseBranchData(pi, repoRoot, options.baseRef ?? null)
    : null;
  const baseBranchOutput = baseBranch != null
    ? await runGitAllowFailure(pi, repoRoot, ["diff", "--find-renames", "-M", "--name-status", `${baseBranch.mergeBase}..HEAD`, "--"])
    : "";

  const worktreeChanges = filterReviewableChanges(mergeChangedPaths(parseNameStatus(trackedDiffOutput), parseUntrackedPaths(untrackedOutput)));
  const deletedPaths = new Set(parseTrackedPaths(deletedFilesOutput));
  const currentPaths = uniquePaths([...parseTrackedPaths(trackedFilesOutput), ...parseTrackedPaths(untrackedOutput)])
    .filter((path) => !deletedPaths.has(path))
    .filter(isReviewableFilePath);
  const currentPathsSet = new Set(currentPaths);
  const lastCommitChanges = filterReviewableChanges(parseNameStatus(lastCommitOutput));
  const baseBranchChanges = filterReviewableChanges(parseNameStatus(baseBranchOutput));

  const seeds = new Map<string, ReviewFileSeed>();

  for (const path of currentPaths) {
    seeds.set(path, createSeed(path, true));
  }

  for (const change of worktreeChanges) {
    const key = resolveSeedKey(change);
    const seed = upsertSeed(seeds, key, () => createSeed(key, change.newPath != null));
    seed.worktreeStatus = change.status;
    seed.hasWorkingTreeFile = change.newPath != null;
    seed.inGitDiff = true;
    seed.gitDiff = toComparison(change);
  }

  for (const change of lastCommitChanges) {
    const key = resolveSeedKey(change);
    const seed = upsertSeed(seeds, key, () => createSeed(key, change.newPath != null && currentPathsSet.has(change.newPath)));
    seed.inLastCommit = true;
    seed.lastCommit = toComparison(change);
  }

  for (const change of baseBranchChanges) {
    const key = resolveSeedKey(change);
    const seed = upsertSeed(seeds, key, () => createSeed(key, change.newPath != null && currentPathsSet.has(change.newPath)));
    seed.inBaseBranch = true;
    seed.baseBranch = toComparison(change);
  }

  if (baseBranch != null) {
    for (const commit of baseBranch.commits) {
      const patchChanges = await getCommitPatchChanges(pi, repoRoot, commit);
      const cumulativeChanges = await getCommitCumulativeChanges(pi, repoRoot, baseBranch.mergeBase, commit.id);

      for (const change of patchChanges) {
        const key = resolveSeedKey(change);
        const seed = upsertSeed(seeds, key, () => createSeed(key, change.newPath != null && currentPathsSet.has(change.newPath)));
        const existing = seed.commitComparisons[commit.id] ?? { patch: null, cumulative: null };
        seed.commitComparisons[commit.id] = {
          ...existing,
          patch: toComparison(change),
        };
      }

      for (const change of cumulativeChanges) {
        const key = resolveSeedKey(change);
        const seed = upsertSeed(seeds, key, () => createSeed(key, change.newPath != null && currentPathsSet.has(change.newPath)));
        const existing = seed.commitComparisons[commit.id] ?? { patch: null, cumulative: null };
        seed.commitComparisons[commit.id] = {
          ...existing,
          cumulative: toComparison(change),
        };
      }
    }
  }

  const files = [...seeds.values()]
    .map(createReviewFile)
    .sort(compareReviewFiles);

  return { repoRoot, files, baseBranch };
}

function getBaseBranchComparison(
  file: ReviewFile,
  baseMode: BaseReviewMode | null | undefined,
  commitId: string | null | undefined,
): ReviewFileComparison | null {
  const mode = baseMode ?? "full";
  if (mode === "full") return file.baseBranch;
  if (commitId == null) return null;
  return file.commitComparisons[commitId]?.[mode] ?? null;
}

export async function loadReviewFileContents(
  pi: ExtensionAPI,
  repoRoot: string,
  file: ReviewFile,
  scope: ReviewScope,
  baseBranch: ReviewBaseBranchData | null,
  baseMode: BaseReviewMode | null | undefined = null,
  commitId: string | null | undefined = null,
): Promise<ReviewFileContents> {
  if (scope === "all-files") {
    const content = file.hasWorkingTreeFile ? await getWorkingTreeContent(repoRoot, file.path) : "";
    return {
      originalContent: content,
      modifiedContent: content,
    };
  }

  if (scope === "base-branch") {
    if (baseBranch == null) {
      return {
        originalContent: "",
        modifiedContent: "",
      };
    }

    const mode = baseMode ?? "full";
    const comparison = getBaseBranchComparison(file, mode, commitId);
    if (comparison == null) {
      return {
        originalContent: "",
        modifiedContent: "",
      };
    }

    const originalRevision = mode === "patch"
      ? `${commitId}^`
      : baseBranch.mergeBase;
    const modifiedRevision = mode === "full"
      ? "HEAD"
      : commitId;

    const originalContent = comparison.oldPath == null ? "" : await getRevisionContent(pi, repoRoot, originalRevision, comparison.oldPath);
    const modifiedContent = comparison.newPath == null || modifiedRevision == null
      ? ""
      : await getRevisionContent(pi, repoRoot, modifiedRevision, comparison.newPath);

    return {
      originalContent,
      modifiedContent,
    };
  }

  const comparison = scope === "git-diff" ? file.gitDiff : file.lastCommit;
  if (comparison == null) {
    return {
      originalContent: "",
      modifiedContent: "",
    };
  }

  const originalRevision = scope === "git-diff" ? "HEAD" : "HEAD^";
  const modifiedRevision = scope === "git-diff" ? null : "HEAD";

  const originalContent = comparison.oldPath == null ? "" : await getRevisionContent(pi, repoRoot, originalRevision, comparison.oldPath);
  const modifiedContent = comparison.newPath == null
    ? ""
    : modifiedRevision == null
      ? await getWorkingTreeContent(repoRoot, comparison.newPath)
      : await getRevisionContent(pi, repoRoot, modifiedRevision, comparison.newPath);

  return {
    originalContent,
    modifiedContent,
  };
}

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Project } from './config.js';

export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathError';
  }
}

const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin';

function norm(p: string): string {
  const n = path.resolve(p);
  return caseInsensitive ? n.toLowerCase() : n;
}

/** True if `child` is `parent` or inside it (both must already be resolved real paths). */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(norm(parent), norm(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function realDir(p: string): string {
  let real: string;
  try {
    real = fs.realpathSync.native(p);
  } catch {
    throw new PathError('Folder does not exist');
  }
  if (!fs.statSync(real).isDirectory()) throw new PathError('Not a folder');
  return real;
}

/**
 * Resolve the working directory for a session. `sub` is an optional path
 * relative to the project root. Rejects `..` traversal and symlinks or
 * junctions that lead outside the project.
 */
export function resolveSessionCwd(project: Project, sub?: string): string {
  const root = realDir(project.path);
  if (!sub || sub === '.' || sub === '') return root;
  if (path.isAbsolute(sub) || /^[A-Za-z]:/.test(sub)) {
    throw new PathError('Sub-folder must be relative to the project');
  }
  if (sub.split(/[\\/]+/).includes('..')) throw new PathError('Path traversal is not allowed');
  const candidate = path.resolve(root, sub);
  if (!isInside(root, candidate)) throw new PathError('Path is outside the project');
  const real = realDir(candidate);
  if (!isInside(root, real)) throw new PathError('Path escapes the project through a link');
  return real;
}

/** Is `dir` (after resolving links) inside one of the projects? */
export function findProjectFor(projects: Project[], dir: string): Project | undefined {
  let real: string;
  try {
    real = fs.realpathSync.native(dir);
  } catch {
    return undefined;
  }
  return projects.find((p) => {
    try {
      return isInside(fs.realpathSync.native(p.path), real);
    } catch {
      return false;
    }
  });
}

export function projectIdFor(absPath: string): string {
  const base = path
    .basename(absPath)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  const hash = createHash('sha256').update(norm(absPath)).digest('hex').slice(0, 6);
  return `${base || 'project'}-${hash}`;
}

/** Validate a folder for `projects add`. Returns the project to store. */
export function makeProject(input: string, name?: string, cwd: string = process.cwd()): Project {
  const abs = path.resolve(cwd, input);
  const real = realDir(abs);
  if (path.parse(real).root === real) throw new PathError('Refusing to add a filesystem root');
  return { id: projectIdFor(real), name: name?.trim() || path.basename(real), path: real };
}

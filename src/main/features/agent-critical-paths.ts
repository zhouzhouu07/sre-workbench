// Shared by lexical risk scoring and the remote guard after realpath resolution.
export const criticalStructuredPaths = [
  "/etc/shadow", "/etc/passwd", "/etc/sudoers", "/etc/ssh",
  "/boot", "/dev", "/sys", "/proc/sys",
] as const;

export function isCriticalStructuredPath(file: string) {
  return criticalStructuredPaths.some(root => file === root || file.startsWith(root + "/"));
}

export const criticalTargetGuard = `case "$target" in ${criticalStructuredPaths.map(root => `${root}|${root}/*`).join("|")}) echo 'CRITICAL：拒绝变更解析后的系统关键路径' >&2; exit 1;; esac\n`;

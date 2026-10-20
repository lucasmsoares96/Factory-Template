#!/usr/bin/env node
// PreToolUse hook (matcher: Bash) of the git-guardrails skill. Claude Code sends
// the tool call as JSON on stdin; exit code 2 blocks it and shows stderr to the
// agent, exit 0 lets it run.
//
// Blocked: git push, reset --hard, clean (any form), branch -D / -f / -M,
// checkout and switch to another branch (including -b/-B/-c/-C), and wide
// restores (`git checkout -- .`, `git restore .`). Allowed on purpose: merge,
// commit, add, status, log, diff, worktree add/remove/list, branch -d, branch
// <name>, and restoring named files with `git checkout [<tree>] -- <path>` or
// `git restore <path>` (undoing your own edit to a file is safe and needed,
// for example to put a published migration back).
//
// The command is parsed as shell (quotes, substitutions, heredocs, bash -c),
// so `git commit -m "no git push here"` is not mistaken for a push.
//
// Plain Node on purpose: the Factory image has no `jq`.

import { pathToFileURL } from "node:url";

const WRAPPERS = new Set(["env", "sudo", "xargs", "time", "nice", "command", "exec", "nohup", "timeout", "stdbuf", "ionice", "builtin"]);
const KEYWORDS = new Set(["{", "!", "if", "then", "else", "elif", "do", "while", "until"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const GIT_VALUE_OPTIONS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env"]);
const WIDE_PATHSPECS = new Set([".", "./", "*", ":/", ":/*", ":/.", "..", "../"]);

/** Splits `src` into simple commands (arrays of words), descending into substitutions. */
export function parseCommands(src) {
  const commands = [];
  let words = [];
  let cur = "";
  let inWord = false;
  const pendingHeredocs = [];

  const endWord = () => {
    if (inWord) words.push(cur);
    cur = "";
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };
  const matching = (from, open, close) => {
    // Index of the `close` that matches the `open` just before `from`.
    let depth = 1;
    let quote = "";
    for (let j = from; j < src.length; j++) {
      const ch = src[j];
      if (ch === "\\" && quote !== "'") j++;
      else if (quote) {
        if (ch === quote) quote = "";
      } else if (ch === "'" || ch === '"') quote = ch;
      else if (ch === open) depth++;
      else if (ch === close && --depth === 0) return j;
    }
    return src.length;
  };
  const substitute = (inner) => {
    for (const command of parseCommands(inner)) commands.push(command);
  };
  const readBackticks = (from) => {
    let j = from;
    while (j < src.length && src[j] !== "`") j += src[j] === "\\" ? 2 : 1;
    return j;
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      if (src[i + 1] === "\n") i += 2;
      else {
        cur += src[i + 1] ?? "";
        inWord = true;
        i += 2;
      }
    } else if (ch === "'") {
      const end = src.indexOf("'", i + 1);
      const stop = end === -1 ? src.length : end;
      cur += src.slice(i + 1, stop);
      inWord = true;
      i = stop + 1;
    } else if (ch === '"') {
      inWord = true;
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\") {
          cur += src[i + 1] ?? "";
          i += 2;
        } else if (src[i] === "$" && src[i + 1] === "(") {
          const end = matching(i + 2, "(", ")");
          substitute(src.slice(i + 2, end));
          cur += "x";
          i = end + 1;
        } else if (src[i] === "`") {
          const end = readBackticks(i + 1);
          substitute(src.slice(i + 1, end));
          cur += "x";
          i = end + 1;
        } else cur += src[i++];
      }
      i++;
    } else if (ch === "$" && src[i + 1] === "(") {
      const end = matching(i + 2, "(", ")");
      substitute(src.slice(i + 2, end));
      cur += "x";
      inWord = true;
      i = end + 1;
    } else if (ch === "`") {
      const end = readBackticks(i + 1);
      substitute(src.slice(i + 1, end));
      cur += "x";
      inWord = true;
      i = end + 1;
    } else if (ch === "<" && src[i + 1] === "<" && src[i + 2] !== "<") {
      const m = /^<<(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|\\?([^\s;&|<>()]+))/.exec(src.slice(i));
      if (m) {
        pendingHeredocs.push({ tag: m[2] ?? m[3] ?? m[4], dash: m[1] === "-", expands: m[2] === undefined && m[3] === undefined && !src.slice(i).startsWith("<<\\") });
        i += m[0].length;
      } else i += 2;
      endWord();
    } else if (ch === "\n") {
      endCommand();
      i++;
      while (pendingHeredocs.length) {
        const { tag, dash, expands } = pendingHeredocs.shift();
        const body = [];
        while (i < src.length) {
          const eol = src.indexOf("\n", i);
          const line = src.slice(i, eol === -1 ? src.length : eol);
          i = eol === -1 ? src.length : eol + 1;
          if ((dash ? line.replace(/^\t+/, "") : line) === tag) break;
          body.push(line);
        }
        // An unquoted heredoc expands `$(...)` and backticks: those run.
        if (expands) {
          const text = body.join("\n");
          for (const m of text.matchAll(/\$\(/g)) substitute(text.slice(m.index + 2, matchingIn(text, m.index + 2)));
          for (const m of text.matchAll(/`([^`]*)`/g)) substitute(m[1]);
        }
      }
    } else if (ch === "#" && !inWord) {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (ch === ";" || ch === "&" || ch === "|" || ch === "(" || ch === ")") {
      endCommand();
      i++;
    } else if (ch === " " || ch === "\t") {
      endWord();
      i++;
    } else {
      cur += ch;
      inWord = true;
      i++;
    }
  }
  endCommand();
  return commands;
}

function matchingIn(text, from) {
  let depth = 1;
  for (let j = from; j < text.length; j++) {
    if (text[j] === "(") depth++;
    else if (text[j] === ")" && --depth === 0) return j;
  }
  return text.length;
}

const base = (word) => word.slice(word.lastIndexOf("/") + 1);

/** The reason the command must not run, or null. */
export function findViolation(commandLine, depth = 0) {
  if (depth > 5) return null;
  for (const raw of parseCommands(commandLine)) {
    let words = raw;
    while (words.length && (KEYWORDS.has(words[0]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]))) words = words.slice(1);
    if (!words.length) continue;
    const head = base(words[0]);

    if (SHELLS.has(head)) {
      const flag = words.findIndex((w, k) => k > 0 && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(w));
      if (flag !== -1 && words[flag + 1] !== undefined) {
        const inner = findViolation(words[flag + 1], depth + 1);
        if (inner) return inner;
      }
      continue;
    }
    if (head === "eval") {
      const inner = findViolation(words.slice(1).join(" "), depth + 1);
      if (inner) return inner;
      continue;
    }

    let gitAt = -1;
    if (head === "git") gitAt = 0;
    else if (WRAPPERS.has(head)) gitAt = words.findIndex((w, k) => k > 0 && base(w) === "git");
    if (gitAt === -1) continue;

    const violation = gitViolation(words.slice(gitAt + 1));
    if (violation) return violation;
  }
  return null;
}

function gitViolation(args) {
  let k = 0;
  while (k < args.length && args[k].startsWith("-")) {
    k += GIT_VALUE_OPTIONS.has(args[k]) ? 2 : 1;
  }
  const sub = args[k];
  const rest = args.slice(k + 1);
  const flags = rest.filter((a) => a.startsWith("-") && a !== "--");
  const dashdash = rest.indexOf("--");
  const hasShort = (letter) => flags.some((f) => /^-[a-zA-Z]+$/.test(f) && f.includes(letter));

  switch (sub) {
    case "push":
      return "git push";
    case "clean":
      return "git clean";
    case "reset":
      return flags.includes("--hard") ? "git reset --hard" : null;
    case "branch":
      if (hasShort("D") || hasShort("M") || hasShort("f") || flags.includes("--force")) return "git branch with -D/-M/-f (force)";
      if (flags.includes("--delete") && flags.includes("--force")) return "git branch --delete --force";
      return null;
    case "switch":
      return "git switch (changes the current branch)";
    case "checkout": {
      if (hasShort("b") || hasShort("B") || hasShort("t") || hasShort("f") || flags.some((f) => ["--orphan", "--detach", "--track", "--force"].includes(f))) {
        return "git checkout that creates or switches a branch, or forces";
      }
      if (dashdash === -1) {
        // `git checkout <name>` and `git checkout -` switch branches; a bare `git checkout` only reports status.
        return rest.some((a) => !a.startsWith("-") || a === "-") ? "git checkout <branch>" : null;
      }
      return rest.slice(dashdash + 1).some((p) => WIDE_PATHSPECS.has(p)) ? "git checkout -- . (discards every change)" : null;
    }
    case "restore": {
      const paths = rest.filter((a, idx) => !a.startsWith("-") && !(idx > 0 && /^--(source|pathspec-from-file)$/.test(rest[idx - 1])));
      return paths.some((p) => WIDE_PATHSPECS.has(p)) ? "git restore . (discards every change)" : null;
    }
    default:
      return null;
  }
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  let command;
  try {
    command = JSON.parse(input)?.tool_input?.command;
  } catch {
    return 0;
  }
  if (typeof command !== "string") return 0;
  const violation = findViolation(command);
  if (!violation) return 0;
  process.stderr.write(
    `BLOCKED: '${command}' runs ${violation}. The user has prevented you from doing this: the harness publishes, resets and switches branches, not you. ` +
      "Work on the current branch, commit with `git commit`, and say in your final message if you need something else.\n",
  );
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();

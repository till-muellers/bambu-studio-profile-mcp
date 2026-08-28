import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { strings } from "./strings.js";
import type { RawProfile } from "./types.js";

/** One message per failure mode a profile-file read distinguishes. */
export interface ProfileFileMessages {
  notFound: (path: string) => string;
  notJson: (path: string) => string;
  notObject: (path: string) => string;
  /** Set by callers that report a file they cannot read apart from one they cannot parse. */
  notReadable?: (path: string) => string;
}

/** Adds the message for a file that must name the parent it overrides. */
export interface InheritingProfileFileMessages extends ProfileFileMessages {
  missingInherits: (path: string) => string;
}

/** The message set for a profile file the caller names by output directory and profile name. */
export const PROFILE_FILE_MESSAGES: InheritingProfileFileMessages = {
  notFound: strings.messages.resolveFileNotFound,
  notJson: strings.messages.resolveFileNotJson,
  notObject: strings.messages.resolveFileNotObject,
  missingInherits: strings.messages.resolveFileMissingInherits,
};

/** Reads the text of a profile file; a read failure reports notReadable where the caller sets it. */
async function readProfileText(path: string, messages: ProfileFileMessages): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    throw new Error((messages.notReadable ?? messages.notJson)(path));
  }
}

/** Reads a profile file as a JSON object. */
export async function readProfileFile(
  path: string,
  messages: ProfileFileMessages
): Promise<RawProfile> {
  if (!existsSync(path)) throw new Error(messages.notFound(path));
  const text = await readProfileText(path, messages);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(messages.notJson(path));
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(messages.notObject(path));
  }
  return parsed as RawProfile;
}

/** Reads a profile file that must name a non-empty parent in 'inherits'. */
export async function readInheritingProfileFile(
  path: string,
  messages: InheritingProfileFileMessages
): Promise<RawProfile & { inherits: string }> {
  const source = await readProfileFile(path, messages);
  if (typeof source.inherits !== "string" || source.inherits === "") {
    throw new Error(messages.missingInherits(path));
  }
  return source as RawProfile & { inherits: string };
}

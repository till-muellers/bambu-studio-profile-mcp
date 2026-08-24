export const strings = {
  tools: {
    // Source: src/tools/resolve.ts registerResolveTools(...)
    resolveProfile: {
      title: "Resolve profile",
      description:
        "Resolve a Bambu Studio process, filament, or machine profile's fully-merged active settings. Walks the " +
        "profile's 'inherits' chain across the configured user preset store and the vendor's system " +
        "profiles, merging settings root-first so a more specific profile's values override its " +
        "ancestors'.\n\n" +
        "Returns: { vendor, name, kind, chain: string[] (root-first), settings: object } — settings is " +
        "the flat merged key->value map; scalar options are bare strings like \"0.2\", per-extruder " +
        "options are string arrays like [\"250\",\"500\",\"500\"]. settings also includes " +
        "print_extruder_variant (process), filament_extruder_variant (filament), or " +
        "printer_extruder_variant (machine), which names what " +
        "each position of every other vector option's array means for this profile. The machine " +
        "profile's printer_extruder_variant is the authoritative column count: resolve the machine " +
        "kind to learn how many elements a per-extruder array needs. A \"nil\" vector column carries " +
        "the value its parent supplies for that column, and settings shows that value: nilResolved " +
        "maps key -> column indices filled from a parent, nilUnresolved maps key -> column indices " +
        "still \"nil\" because a parent value for them was out of reach. Each field appears only " +
        "when it has an entry. The filament_* override family reads its columns from the machine " +
        "preset named by machineName, matching the key with the filament_ prefix stripped. With " +
        "keys given, settings carries exactly the requested keys and missingKeys lists the requested " +
        "keys the resolved profile lacks; the inherits chain is walked in full either way.\n\n" +
        "Errors: vendor not found; profile not found; circular or unresolvable inherits chain; config " +
        "missing (run init_config first).\n\n" +
        "Discover valid vendor and name values with list_vendors and list_profiles. Typical use: inspect " +
        "a profile's effective settings before creating a variant of it with write_profile.",
      inputs: {
        kind:
          "Profile type to resolve; 'machine' reads the printer preset Bambu Studio owns, whose " +
          "printer_extruder_variant fixes the column count of every per-extruder vector option",
        vendor:
          "Vendor id from list_vendors, e.g. 'BBL'. Required for user presets too: it names the system " +
          "store their inherits chain can reference",
        name: "Exact profile name as returned by list_profiles (the 'name' field inside the profile JSON)",
        keys:
          "Option keys to keep in settings, e.g. ['layer_height','wall_loops']; omit for the whole " +
          "merged map. Applied after the chain is merged, so inherited values still decide each key's " +
          "value. Keys absent from the resolved profile come back in missingKeys",
        machineName:
          "Exact name of the machine preset whose columns the filament_* override family reads, e.g. " +
          "'Bambu Lab X1 Carbon 0.4 nozzle'. Resolved under the same vendor. Give it to see what a " +
          "\"nil\" column of filament_retraction_length, filament_wipe, or any other filament_* " +
          "override becomes on that printer; omit it to keep those columns as the profile states them, " +
          "listed in nilUnresolved",
      },
    },
    // Source: src/tools/write.ts registerWriteTools(...)
    writeProfile: {
      title: "Write profile",
      description:
        "Create a Bambu Studio process or filament profile file: writes <outputDir>/<name>.json, " +
        "inheriting from baseProfile and containing only the kvps overrides. Overwrites the file when it " +
        "already exists; Bambu Studio's own directories stay untouched. Overwriting REPLACES the previous " +
        "content wholesale — kvps is always the complete override set; use update_profile to change an " +
        "existing file incrementally. Every kvps key and value is validated against the option schema " +
        "before anything is written; all violations are reported together.\n\n" +
        "Returns: { vendor, name, kind, created (false when an existing file was overwritten), path, " +
        "inherits, overrides }\n\n" +
        "Errors: baseProfile not found or unresolvable; schema violations listed per key; config " +
        "missing (run init_config first).\n\n" +
        "Typical flow to extend an existing profile: find it with list_profiles, inspect its effective " +
        "settings with resolve_profile, look up valid option keys and value ranges with list_parameters, " +
        "then call write_profile with only the changed keys as kvps. For a vector option, resolve the " +
        "base profile first, copy the existing array for that key, modify only the positions you mean " +
        "to change, and pass the full-length array back — a shorter array is accepted but Bambu Studio " +
        "broadcast-resizes it (repeating the last value), which is rarely what you want.",
      inputs: {
        kind: "Profile type to create",
        vendor: "Vendor id from list_vendors, e.g. 'BBL'; names the system store baseProfile is resolved against",
        name: "Name of the profile to create; also the output filename (<name>.json)",
        baseProfile: "Exact name of the existing profile to inherit from, as returned by list_profiles",
        kvps:
          "Object mapping option key to value, validated against schema/<kind>.schema.json. Scalar options " +
          "take a single string like \"0.2\" or \"100%\"; vector (per-extruder) options take a string array " +
          "with one element per position of the base profile's variant list — the " +
          "print_extruder_variant/filament_extruder_variant array visible in resolve_profile's settings — " +
          "like [\"200\",\"500\",\"500\"] for a 3-position profile. \"nil\" as an element keeps the base " +
          "value at that position and is valid only on options list_parameters marks nullable: true. " +
          "Example: {\"layer_height\": \"0.16\", \"outer_wall_speed\": [\"150\",\"400\",\"400\"]}. " +
          "'name' and 'inherits' are reserved, set via the name/baseProfile arguments instead.",
        outputDir: "Directory the profile file is written to; created if missing",
      },
    },
    // Source: src/tools/update.ts registerUpdateTool(...)
    updateProfile: {
      title: "Update profile",
      description:
        "Incrementally edit a profile file previously created by write_profile: upsert the `set` keys and " +
        "delete the `remove` keys in one atomic, validated step. Keys not mentioned stay unchanged. The " +
        "file's name and inherits stay as they are.\n\n" +
        "Returns: { name, kind, path, set (applied set keys), removed (applied remove keys), overrides " +
        "(the file's final key->value map excluding name/inherits) }\n\n" +
        "Errors: file not found in outputDir (create it with write_profile first); schema violations, " +
        "reserved keys in set/remove, and unknown remove keys are all listed together; nothing to do when " +
        "both set and remove are omitted; config missing (run init_config first).\n\n" +
        "write_profile replaces a file wholesale; update_profile is the tool for incremental changes.",
      inputs: {
        kind: "Profile type; selects the validation schema",
        name: "Name of the existing profile file, <name>.json in outputDir",
        outputDir: "Directory containing the profile file",
        set:
          "Object mapping option key to value, validated against schema/<kind>.schema.json. Scalar options " +
          "take a single string like \"0.2\" or \"100%\"; vector (per-extruder) options take a string array " +
          "with one element per position of the base profile's variant list. \"nil\" as an element keeps the " +
          "base value at that position and is valid only on options list_parameters marks nullable: true. " +
          "Existing keys are overwritten, new keys are added. 'name' and 'inherits' are reserved.",
        remove: "Override keys to delete from the file; each key must already exist in the file.",
      },
    },
    // Source: src/tools/init-config.ts registerInitConfigTool(...)
    initConfig: {
      title: "Initialize configuration",
      description:
        `Set and persist the Bambu Studio installDir, userDataDir, and userId used by all other tools. ` +
        `Required once before any other tool succeeds; on a machine with Bambu Studio installed, calling ` +
        `it with no arguments usually suffices — every value is auto-detected (userId from ` +
        `<userDataDir>\\BambuStudio.conf's app.preset_folder, the logged-in account's preset folder). ` +
        `Takes effect immediately — no server restart needed. Configuration persists per project in ` +
        `.bambu-studio-profile-mcp/config.json, resolved from CLAUDE_PROJECT_DIR under Claude Code, the ` +
        `working directory otherwise, or the BAMBU_STUDIO_PROFILE_MCP_CONFIG_DIR override.\n\n` +
        `Returns: { installDir, userDataDir, userId, persistedTo }\n\n` +
        `Errors: each invalid or undetectable value is reported (including userId when BambuStudio.conf ` +
        `is missing, unparseable, or lacks app.preset_folder); nothing is persisted on failure.`,
      inputs: {
        installDir: "Bambu Studio install dir containing resources/profiles; auto-detected if omitted",
        userDataDir: "Bambu Studio user-data dir containing the user/ preset store; auto-detected if omitted",
        userId:
          "The user/<userId> directory resolution reads (a cloud-account id or 'default'). Auto-detected from " +
          "<userDataDir>\\BambuStudio.conf's app.preset_folder when omitted; pass explicitly to override " +
          "(e.g. to target 'default').",
      },
    },
    // Source: src/tools/list.ts (four register functions)
    listProfiles: {
      title: "List profiles",
      description:
        "Discover the process, filament, or machine profiles available in the user preset store and the vendors' " +
        "system stores.\n\n" +
        "Returns: { kind, profiles: [{ name, source: \"user\"|\"system\", vendor?, inherits? }] } — " +
        "user presets carry no vendor field; inherits names a profile's parent.\n\n" +
        "Errors: vendor not found (only when vendor is given); config missing (run init_config first).\n\n" +
        "Results feed the vendor/name/baseProfile arguments of resolve_profile and write_profile.",
      inputs: {
        kind: "Profile type to list; 'machine' lists the printer presets Bambu Studio owns",
        vendor: "Vendor id from list_vendors, e.g. 'BBL'; omit to search every vendor",
        search: "Case-insensitive substring filter on the profile name, e.g. 'PETG' or '0.16'",
        source:
          "Restrict the rows to one store: 'user' for the user preset store, 'system' for the vendors' " +
          "shipped profiles; omit to get both",
      },
    },
    listVendors: {
      title: "List vendors",
      description:
        "List the profile vendors shipped with Bambu Studio.\n\n" +
        "Returns: { vendors: [{ id, name }] }, sorted by id — id (e.g. 'BBL') is the value the vendor " +
        "arguments of resolve_profile, write_profile, and list_profiles expect; name is the display " +
        "name (e.g. 'Bambulab').\n\n" +
        "Errors: config missing (run init_config first).",
    },
    listParameters: {
      title: "List parameters",
      description:
        "Discover the option keys valid for process, filament, or machine profiles, with their value type, " +
        "range/enum, default, and (where Bambu Studio provides them) the GUI label and description. " +
        "Search by name or by what a setting does — the filter matches key, label, and description.\n\n" +
        "Returns: { kind, parameters: [{ key, type, vector, enum?, min?, max?, default?, label?, " +
        "description?, nullable? }] } — vector: true means the option takes a string array with one " +
        "element per (extruder × hotend-variant) position of the target profile — see the profile's " +
        "print_extruder_variant/filament_extruder_variant, or the machine profile's " +
        "printer_extruder_variant, in resolve_profile's settings; vector: false " +
        "a single value. Options marked nullable: true accept \"nil\" as an element (or as the whole " +
        "value) to keep the base/printer value at that position.\n\n" +
        "Errors: config missing (run init_config first).\n\n" +
        "Results feed the kvps argument of write_profile: use key as the kvps key and respect " +
        "type/vector/enum/min/max/nullable when choosing the value.",
      inputs: {
        kind:
          "Profile type whose option schema to list; 'machine' lists the printer option keys, which " +
          "write_profile and update_profile leave to Bambu Studio",
        search: "Case-insensitive substring matched against key, label, and description, e.g. 'seam' or 'temperature'",
      },
    },
    listFilaments: {
      title: "List filaments",
      description:
        "List the distinct filament products known to Bambu Studio: every filament_id found across the " +
        "user store and all vendors' filament profiles, with a display name.\n\n" +
        "Returns: { filaments: [{ id, name }] }, sorted by id, deduplicated — id is the product code " +
        "(e.g. 'GFB00'), name the human-readable filament name (e.g. 'Bambu ABS').\n\n" +
        "Errors: config missing (run init_config first).\n\n" +
        "Use it to see which filaments exist, then find their concrete profiles by name via " +
        "list_profiles with kind 'filament'.",
    },
    // Source: src/tools/import.ts registerImportTools(...)
    importProfile: {
      title: "Import profile",
      description:
        "Install a profile file into Bambu Studio's user preset store (user/<userId>/<kind>/), " +
        "synthesizing the metadata Bambu Studio expects (from, version, settings id) and a minimal " +
        ".info sidecar. Sources written by write_profile and Studio-shaped preset files both work: " +
        "metadata keys already present in the source (from, version, settings id) are ignored and " +
        "regenerated. The source's remaining keys are fully re-validated against the option schema " +
        "first and its inherits chain is resolved; nothing is installed when any check fails. " +
        "Replacing an existing preset requires overwrite: true and only ever replaces presets whose " +
        "own 'from' field is \"User\".\n\n" +
        "Returns: { kind, name, path, infoPath, overwritten, note } — note states that Bambu Studio " +
        "sees the preset after a restart.\n\n" +
        "Errors: source missing or unparseable; schema violations listed per key; vendor or inherits " +
        "target not found; target exists without overwrite; target's 'from' is not \"User\" (refused " +
        "regardless of flags); config missing (run init_config first).\n\n" +
        "Typical flow: write_profile into an outputDir, then import_profile with the same " +
        "outputDir/name. Remove an installed preset again with remove_profile.",
      inputs: {
        kind: "Profile type to import",
        vendor:
          "Vendor id from list_vendors, e.g. 'BBL'; names the system store the source's inherits chain is resolved against",
        outputDir: "Directory containing the source file written by write_profile",
        name: "Name of the profile to import; locates <outputDir>/<name>.json and names the installed preset",
        overwrite: "Pass true to replace an existing user preset of the same name; defaults to false",
      },
    },
    // Source: src/tools/import.ts registerRemoveProfile(...)
    removeProfile: {
      title: "Remove profile",
      description:
        "Delete a user preset (its JSON plus .info sidecar) from Bambu Studio's user preset store " +
        "(user/<userId>/<kind>/). Only presets whose own 'from' field is \"User\" are removable. " +
        "When the preset has a cloud record (populated setting_id in its sidecar) it is still " +
        "removed locally and the result flags cloudRecord: true, since Bambu Studio's sync may " +
        "restore it.\n\n" +
        "Returns: { kind, name, removedJson, removedInfo, cloudRecord, note } — removedInfo is null " +
        "when no sidecar existed; note states that Bambu Studio sees the change after a restart.\n\n" +
        "Errors: preset not found; a stray sidecar without its JSON; the preset's 'from' is not " +
        "\"User\" or its JSON is unparseable (refused regardless of flags); config missing (run " +
        "init_config first).\n\n" +
        "Discover installed user presets with list_profiles (source \"user\").",
      inputs: {
        kind: "Profile type to remove",
        name: "Name of the user preset to remove from user/<userId>/<kind>/",
      },
    },
    diffProfile: {
      title: "Diff profile",
      description:
        "Compare a profile file in a caller-chosen directory against the preset currently installed " +
        "in Bambu Studio's user preset store (user/<userId>/<kind>/), flat key by key. Reads back " +
        "values hand-tuned in Bambu Studio and surfaces drift between a project's profile files and " +
        "the installed presets. Both sides inherit equivalently, so the files' own keys are compared " +
        "directly; 'inherits' is compared too, while identity and synthesized metadata (name, from, " +
        "version, settings ids) are skipped.\n\n" +
        "Returns: { identical, changed: [{key, source, installed}], onlyInSource: [{key, value}], " +
        "onlyInstalled: [{key, value}], source: {path, modifiedAt}, installed: {path, modifiedAt}, " +
        "newer } — modifiedAt is the file's ISO 8601 mtime and newer says which side changed last " +
        "(\"source\", \"installed\", or \"same\").\n\n" +
        "Errors: source file missing or unparseable; preset absent from the user store; config " +
        "missing (run init_config first).\n\n" +
        "Sync drift back with update_profile (project file) or import_profile with overwrite " +
        "(installed preset). Discover installed presets with list_profiles (source \"user\").",
      inputs: {
        kind: "Profile type to compare",
        name: "Name of the installed preset in user/<userId>/<kind>/",
        outputDir: "Directory containing the local profile file",
        sourceName: "Local file name (without .json) when it differs from the installed preset's name",
      },
    },
    // Source: src/tools/resolve-from-file.ts registerResolveFromFileTool(...)
    resolveFromFile: {
      title: "Resolve profile from file",
      description:
        "Resolve the fully-merged active settings a profile file in a caller-chosen directory would " +
        "have once installed. Reads <outputDir>/<name>.json, walks its 'inherits' chain across the " +
        "configured user preset store and the vendor's system profiles, and applies the file's own " +
        "keys on top, so the file's values override its ancestors'. Identity and synthesized metadata " +
        "(name, from, version, settings ids) stay out of the merged settings. Bambu Studio's " +
        "directories stay untouched.\n\n" +
        "Returns: { vendor, name, kind, chain: string[] (root-first, ending with this file), settings: " +
        "object, path } — settings is the flat merged key->value map, matching resolve_profile's shape; " +
        "path is the file that was read. A \"nil\" vector column carries the value its parent supplies " +
        "for that column, and settings shows that value: nilResolved maps key -> column indices filled " +
        "from a parent, nilUnresolved maps key -> column indices still \"nil\" because a parent value " +
        "for them was out of reach. Each field appears only when it has an entry. The filament_* " +
        "override family reads its columns from the machine preset named by machineName, matching the " +
        "key with the filament_ prefix stripped. With keys given, settings carries exactly the " +
        "requested keys and missingKeys lists the requested keys the merged result lacks; the inherits " +
        "chain is walked in full either way.\n\n" +
        "Errors: file missing or unparseable; file lacking an 'inherits' field; vendor not found; " +
        "inherits target not found; circular or unresolvable inherits chain; config missing (run " +
        "init_config first).\n\n" +
        "Use it to verify a file authored with write_profile or update_profile before installing it " +
        "with import_profile. For presets already installed, resolve_profile is the tool.",
      inputs: {
        kind:
          "Profile type to resolve; 'machine' resolves the file against the printer presets Bambu " +
          "Studio owns",
        vendor:
          "Vendor id from list_vendors, e.g. 'BBL'; names the system store the file's inherits chain " +
          "is resolved against",
        outputDir: "Directory containing the local profile file",
        name: "Name the resolved profile carries; also the file name (<name>.json) unless sourceName says otherwise",
        sourceName: "Local file name (without .json) when it differs from name",
        keys:
          "Option keys to keep in settings, e.g. ['layer_height','wall_loops']; omit for the whole " +
          "merged map. Applied after the chain and the file's own keys are merged, so inheritance still " +
          "decides each key's value. Keys absent from the merged result come back in missingKeys",
        machineName:
          "Exact name of the machine preset whose columns the filament_* override family reads, e.g. " +
          "'Bambu Lab X1 Carbon 0.4 nozzle'. Resolved under the same vendor. Give it to see what a " +
          "\"nil\" column of filament_retraction_length, filament_wipe, or any other filament_* " +
          "override becomes on that printer; omit it to keep those columns as the file states them, " +
          "listed in nilUnresolved",
      },
    },
  },
  errors: {
    // Source: src/errors.ts — each function returns the exact current message
    vendorNotFound: (vendor: string): string => `Vendor '${vendor}' not found under resources/profiles.`,
    profileNotFound: (kind: string, name: string): string => `${kind} profile '${name}' not found in user or system presets.`,
    circularInheritance: (chain: string[]): string => `Circular inherits chain: ${chain.join(" -> ")}`,
    schemaValidation: (violations: { key: string; reason: string }[]): string =>
      `Schema validation failed:\n` + violations.map((v) => `- ${v.key}: ${v.reason}`).join("\n"),
    configMissing:
      "No configuration found for this project (.bambu-studio-profile-mcp/config.json). Call the init_config tool — a plain call with no arguments usually " +
      "suffices, since installDir, userDataDir, and userId (from BambuStudio.conf's app.preset_folder) " +
      "are all auto-detected. Arguments exist as overrides, e.g. to target a specific userId.",
  },
  violations: {
    // Source: src/validator.ts checkScalar/checkValue + src/tools/write.ts + src/tools/update.ts reason literals
    unknownKey: "unknown key (not present in the schema)",
    reservedKeyWrite: "reserved key: set via the 'name'/'baseProfile' argument, not kvps",
    reservedKeyUpdate: "reserved key: managed via write_profile's name/baseProfile arguments",
    bothSetAndRemove: "key appears in both set and remove; choose one",
    keyNotPresent: "key not present in the profile file",
    expectedString: (got: unknown): string => `expected a string, got ${JSON.stringify(got)}`,
    expectedEnum: (allowed: string[], got: unknown): string =>
      `expected one of [${allowed.join(", ")}], got ${JSON.stringify(got)}`,
    expectedBool: (got: unknown): string => `expected a bool (true/false/"0"/"1"), got ${JSON.stringify(got)}`,
    expectedNumeric: (typeLabel: string, got: unknown): string => `expected ${typeLabel}, got ${JSON.stringify(got)}`,
    belowMinimum: (value: number, min: number): string => `value ${value} is below minimum ${min}`,
    aboveMaximum: (value: number, max: number): string => `value ${value} is above maximum ${max}`,
    expectedVector: (type: string, got: unknown): string =>
      `expected a non-empty array of ${type} values, got ${JSON.stringify(got)}`,
    expectedScalar: (type: string): string => `expected a single ${type} value, got an array`,
    element: (index: number, reason: string): string => `element ${index}: ${reason}`,
  },
  warnings: {
    // Source: src/index.ts warnIfUnconfigured — stderr line and notification data text
    unconfiguredStderr:
      "bambu-studio-profile-mcp: no configuration found for this project (.bambu-studio-profile-mcp/config.json) " +
      "— call the init_config tool to get started.",
    unconfiguredNotification:
      "bambu-studio-profile-mcp has no configuration for this project (.bambu-studio-profile-mcp/config.json). " +
      "Call the init_config tool to get started.",
  },
  messages: {
    // Source: src/tools/init-config.ts
    detectionFailed: (missing: string[]): string =>
      `Auto-detection could not determine: ${missing.join(", ")}. Pass ${missing.join(" and ")} explicitly.`,
    userIdNotDetected: (confPath: string): string =>
      `Could not auto-detect userId: '${confPath}' is missing, unparseable, or has no app.preset_folder. ` +
      `Pass userId explicitly.`,
    // Source: src/tools/update.ts
    nothingToDo: "Nothing to do: pass set and/or remove.",
    sourceNotFound: (path: string): string => `Profile file '${path}' not found. write_profile creates profiles.`,
    sourceNotReadable: (path: string): string => `Profile file '${path}' could not be read. write_profile creates profiles.`,
    sourceNotJson: (path: string): string => `Profile file '${path}' is not valid JSON.`,
    sourceNotObject: (path: string): string => `Profile file '${path}' does not contain a JSON object.`,
    // Source: src/validator.ts loadSchema
    schemaFileMissing: (path: string): string => `Schema file '${path}' not found. Run scripts/generate-schema to produce it.`,
    schemaFileInvalid: (path: string): string => `Schema file '${path}' is not valid JSON.`,
    // Source: src/user-presets.ts
    invalidProfileName: (name: string): string =>
      `Invalid profile name '${name}': must be a plain filename without path separators.`,
    studioRestartNote: "Bambu Studio picks this up after a restart.",
    cloudRecordWarning: "A cloud record exists for this preset; Bambu Studio's sync may restore it.",
    // Source: src/tools/import.ts handleImport
    importSourceNotFound: (path: string): string => `Source profile '${path}' not found. Create it with write_profile first.`,
    importSourceNotJson: (path: string): string => `Source profile '${path}' is not valid JSON.`,
    importSourceNotObject: (path: string): string => `Source profile '${path}' does not contain a JSON object.`,
    importSourceMissingInherits: (path: string): string => `Source profile '${path}' has no 'inherits' field.`,
    importMetadataRegenerated: (keys: string[]): string =>
      `Metadata keys in the source file were ignored and regenerated: ${keys.join(", ")}.`,
    importTargetExists: (path: string): string => `Target preset '${path}' already exists. Pass overwrite: true to replace it.`,
    importTargetUnparseable: (path: string): string =>
      `Refusing to overwrite '${path}': cannot verify it is a user preset (unparseable JSON).`,
    importTargetNotUser: (path: string): string => `Refusing to overwrite '${path}': its 'from' field is not "User".`,
    // Source: src/tools/import.ts handleRemove
    diffSourceNotFound: (path: string): string => `Source profile '${path}' not found.`,
    diffSourceNotJson: (path: string): string => `Source profile '${path}' is not valid JSON.`,
    diffInstalledNotFound: (path: string): string =>
      `No preset installed at '${path}'. Install one with import_profile, or check the name with list_profiles.`,
    diffInstalledNotJson: (path: string): string => `Installed preset '${path}' is not valid JSON.`,
    removeStraySidecar: (jsonPath: string, infoPath: string): string =>
      `Preset JSON '${jsonPath}' is missing but a stray sidecar '${infoPath}' exists; nothing was removed.`,
    removeNotFound: (path: string): string => `Preset '${path}' not found in the user store.`,
    removeUnparseable: (path: string): string =>
      `Refusing to remove '${path}': cannot verify it is a user preset (unparseable JSON).`,
    removeNotUser: (path: string): string => `Refusing to remove '${path}': its 'from' field is not "User".`,
    // Source: src/tools/resolve-from-file.ts handleResolveFromFile
    resolveFileNotFound: (path: string): string =>
      `Profile file '${path}' not found. Create it with write_profile first.`,
    resolveFileNotJson: (path: string): string => `Profile file '${path}' is not valid JSON.`,
    resolveFileNotObject: (path: string): string => `Profile file '${path}' does not contain a JSON object.`,
    resolveFileMissingInherits: (path: string): string =>
      `Profile file '${path}' has no 'inherits' field; resolution needs a parent profile to start from.`,
  },
  formats: {
    // Source: src/tools/deps.ts toToolError
    toolError: (message: string): string => `Error: ${message}`,
  },
} as const;

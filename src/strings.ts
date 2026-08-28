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
        "Returns: { vendor, name, kind, chain: string[] (profile names, root-first), settings: object, " +
        "nilResolved?: object, nilUnresolved?: object, missingKeys?: string[] } — vendor, name and " +
        "kind echo the arguments; nilResolved, " +
        "nilUnresolved and missingKeys sit at the top level beside settings, each present when it has " +
        "an entry. settings holds option key->value pairs only: scalar options are bare strings like " +
        "\"0.2\", per-extruder options are string arrays like [\"250\",\"500\",\"500\"]. settings also " +
        "includes print_extruder_variant (process), filament_extruder_variant (filament), or " +
        "printer_extruder_variant (machine), which names what " +
        "each position of every other vector option's array means for this profile. The machine " +
        "profile's printer_extruder_variant is the authoritative column count: resolve the machine " +
        "kind to learn how many elements a per-extruder array needs.\n\n" +
        "A vector option may hold the literal string \"nil\" in a column, meaning the column takes its " +
        "value from that option's parent. For every family except filament_*, the parent is the next " +
        "profile up the inherits chain. For the filament_* family, the parent is the machine preset " +
        "named by machineName, and the value comes from that preset's key with the filament_ prefix " +
        "stripped. A column filled from its parent appears in settings with the parent's value and in " +
        "nilResolved under its option key with its column index; with machineName omitted, filament_* " +
        "columns keep the literal string \"nil\" in settings and appear in nilUnresolved under their " +
        "option key with their column indices.\n\n" +
        "With keys given, settings carries exactly the requested keys and missingKeys lists the " +
        "requested keys the resolved profile lacks; the inherits chain is walked in full either way.\n\n" +
        "Errors: vendor not found; profile not found; circular or unresolvable inherits chain; config " +
        "missing (run init_config first).\n\n" +
        "Discover valid vendor and name values with list_vendors and list_profiles. Profiles in the " +
        "configured user preset store and the vendor's system profiles resolve here; a profile file " +
        "sitting in a caller-chosen directory before installation resolves with resolve_from_file, and " +
        "import_profile installs it into Bambu Studio. Typical use: inspect a profile's effective " +
        "settings before creating a variant of it with write_profile; list_parameters explains what " +
        "each settings key means and which values it accepts.",
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
        "Returns: { vendor, name, kind, created (true for a newly written file, false when an existing " +
        "file was overwritten), path (the file that was written), inherits (the baseProfile the file " +
        "now inherits from), overrides (the kvps map exactly as passed, which is the file's complete " +
        "override set) }\n\n" +
        "Errors: baseProfile not found or unresolvable; schema violations listed per key; config " +
        "missing (run init_config first).\n\n" +
        "Typical flow to extend an existing profile: find it with list_profiles, inspect its effective " +
        "settings with resolve_profile, look up valid option keys and value ranges with list_parameters, " +
        "then call write_profile with only the changed keys as kvps. import_profile installs a file " +
        "written here into Bambu Studio's user preset store. For a vector option, resolve the " +
        "base profile first, copy the existing array for that key, modify only the positions you mean " +
        "to change, and pass the full-length array back — a shorter array is accepted but Bambu Studio " +
        "broadcast-resizes it (repeating the last value), which is rarely what you want.",
      inputs: {
        kind:
          "Profile type to create; machine presets stay Bambu Studio's to write and are readable " +
          "through resolve_profile",
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
        "Returns: { name, kind, path (the file that was rewritten), set (applied set keys), removed " +
        "(applied remove keys), overrides (the file's final key->value map excluding name/inherits) " +
        "}\n\n" +
        "Errors: file not found in outputDir (create it with write_profile first); schema violations, " +
        "reserved keys in set/remove, and unknown remove keys are all listed together; nothing to do when " +
        "both set and remove are omitted; config missing (run init_config first).\n\n" +
        "write_profile replaces a file wholesale; update_profile is the tool for incremental changes. " +
        "Placing a file on a different base profile happens in write_profile: read the current " +
        "overrides here, then recreate the file with the new baseProfile and the complete override " +
        "set as kvps. resolve_from_file reports the settings the file resolves to, including the " +
        "variant array that fixes the length of every vector value.",
      inputs: {
        kind:
          "Profile type; selects the validation schema. Machine presets stay Bambu Studio's to write " +
          "and are readable through resolve_profile",
        name: "Name of the existing profile file, <name>.json in outputDir",
        outputDir: "Directory containing the profile file",
        set:
          "Object mapping option key to value, validated against schema/<kind>.schema.json. Scalar options " +
          "take a single string like \"0.2\" or \"100%\"; vector (per-extruder) options take a string array " +
          "with one element per position of the variant list of the base profile named by the file's " +
          "'inherits' value; resolve the file with resolve_from_file and read its print_extruder_variant " +
          "(process) or filament_extruder_variant (filament) array for the required length. \"nil\" as an " +
          "element keeps the base value at that position and is valid only on options list_parameters " +
          "marks nullable: true. " +
          "Existing keys are overwritten, new keys are added. 'name' and 'inherits' are reserved. " +
          "Omit it to make this call a pure removal.",
        remove:
          "Override keys to delete from the file; each key must already exist in the file. Omit it " +
          "to make this call a pure upsert.",
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
        `working directory otherwise, or the BAMBU_STUDIO_PROFILE_MCP_CONFIG_DIR override. Each call ` +
        `stores a complete configuration: values passed in are used as given, omitted values are ` +
        `auto-detected afresh, and the result becomes the stored configuration for every field.\n\n` +
        `Returns: { installDir, userDataDir, userId, persistedTo } — the three values now in force, ` +
        `plus the config.json path they were written to.\n\n` +
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
        "name is the exact preset name the other tools take, source names the store the row came " +
        "from, vendor appears on system rows and names the vendor shipping the profile, and inherits " +
        "appears where the profile declares a parent and names it.\n\n" +
        "Errors: vendor not found (only when vendor is given); config missing (run init_config first).\n\n" +
        "Results feed the vendor/name arguments of resolve_profile; process and filament rows also " +
        "feed the vendor/name/baseProfile arguments of write_profile, and rows with source \"user\" " +
        "are the presets remove_profile deletes. list_filaments lists the filament products the " +
        "filament presets are built around.",
      inputs: {
        kind:
          "Profile type to list; 'machine' lists the printer presets Bambu Studio maintains, readable " +
          "through resolve_profile",
        vendor:
          "Vendor id from list_vendors, e.g. 'BBL'; scopes the system rows to that vendor, and omit it " +
          "to search every vendor. User rows appear whatever vendor is given, since a user preset " +
          "belongs to the user store rather than to a vendor",
        search:
          "Case-insensitive substring filter on the profile name, e.g. 'PETG' or '0.16'; omit it to " +
          "list every profile of that kind",
        source:
          "Restrict the rows to one store: 'user' for the user preset store, 'system' for the vendors' " +
          "shipped profiles; omit to get both",
      },
    },
    listVendors: {
      title: "List vendors",
      description:
        "List the profile-shipping vendors bundled with Bambu Studio — the organizations whose system " +
        "preset libraries Studio installs.\n\n" +
        "Returns: { vendors: [{ id, name }] }, sorted by id — id (e.g. 'BBL') is the value every " +
        "tool's vendor argument takes, among them resolve_profile, write_profile, and list_profiles; " +
        "name is that vendor's display name (e.g. 'Bambulab').\n\n" +
        "Errors: config missing (run init_config first).\n\n" +
        "For filament products and their labels, call list_filaments.",
    },
    listParameters: {
      title: "List parameters",
      description:
        "Discover the option keys valid for process, filament, or machine profiles, with their value type, " +
        "range/enum, default, and (where Bambu Studio provides them) the GUI label, unit, and description. " +
        "Search by name or by what a setting does — the filter matches key, label, and description.\n\n" +
        "Returns: { kind, parameters: [{ key, type, vector, enum?, min?, max?, default?, unit?, " +
        "label?, description?, nullable? }] } — key is the option key. type names the value's domain " +
        "(string, int, float, percent, bool, enum) while values are written as strings, so an int " +
        "option takes \"255\" and a percent option \"25%\"; int, float, and percent options also " +
        "accept a JSON number, and bool options a JSON boolean or \"0\", \"1\", \"true\", \"false\". " +
        "vector: true means the option takes a string array with one " +
        "element per (extruder × hotend-variant) position of the target profile — see the profile's " +
        "print_extruder_variant/filament_extruder_variant, or the machine profile's " +
        "printer_extruder_variant, in resolve_profile's settings; vector: false means a single string " +
        "like \"0.2\". enum, min, max, default, unit, label, and description appear where the option " +
        "declares them: enum lists the only accepted values, min and max state the bounds to respect, " +
        "default is the value Bambu Studio starts from, unit is the unit the value is expressed in " +
        "(e.g. 'mm', 'mm/s'), and label and description are the GUI texts. Where enum is absent, any " +
        "value of the option's type is accepted; where min or max is absent, that direction is " +
        "unbounded. Options marked nullable: true accept the literal string \"nil\" as an element " +
        "(or as the whole value) to keep the base/printer value at that position; options listing no " +
        "nullable expect a concrete value in every position.\n\n" +
        "Errors: config missing (run init_config first).\n\n" +
        "Results for process and filament feed the kvps argument of write_profile and the set " +
        "argument of update_profile: use key as the kvps key and respect " +
        "type/vector/enum/min/max/nullable when choosing the value. Machine keys describe the printer " +
        "presets Bambu Studio maintains; read their values with resolve_profile.",
      inputs: {
        kind:
          "Profile type whose option schema to list; 'machine' lists the printer option keys Bambu " +
          "Studio maintains, readable through resolve_profile, while write_profile and update_profile " +
          "take process and filament",
        search:
          "Case-insensitive substring matched against key, label, and description, e.g. 'seam' or " +
          "'temperature'; omit it to list every option of that kind",
      },
    },
    listFilaments: {
      title: "List filaments",
      description:
        "List the distinct filament products known to Bambu Studio: every filament_id found across the " +
        "user store and all vendors' filament profiles, with a display name.\n\n" +
        "Returns: { filaments: [{ id, name }] }, sorted by id, deduplicated — id is the product code " +
        "(e.g. 'GFB00'), name is that product's human-readable label (e.g. 'Bambu ABS').\n\n" +
        "Errors: config missing (run init_config first).\n\n" +
        "Use it to see which filaments exist, then call list_profiles with kind 'filament' to list the " +
        "filament presets; preset names are separate strings (e.g. 'Bambu ABS @BBL X1C') and are the " +
        "values resolve_profile and write_profile take. For the profile-shipping vendors and the ids " +
        "the vendor arguments take, call list_vendors.",
    },
    // Source: src/tools/import.ts registerImportTools(...)
    importProfile: {
      title: "Import profile",
      description:
        "Install a profile file into Bambu Studio's user preset store (user/<userId>/<kind>/), " +
        "writing the metadata Bambu Studio expects (from, version, settings id) and a minimal " +
        ".info sidecar. Sources written by write_profile and Studio-shaped preset files both work: " +
        "metadata keys already present in the source (from, version, settings id) are ignored and " +
        "replaced with values this tool writes. The version comes from the vendor bundle index " +
        "(resources/profiles/<vendor>.json); when that index supplies none, the preset carries a " +
        "fallback version instead. The source's remaining keys are fully re-validated against the " +
        "option schema first and its inherits chain is resolved; nothing is installed when any check " +
        "fails. Replacing an existing preset requires overwrite: true and only ever replaces presets " +
        "whose own 'from' field is \"User\".\n\n" +
        "Returns: { kind, name, path, infoPath, overwritten, version, versionSource, metadataWritten, " +
        "note } — path is the installed preset JSON and infoPath its .info sidecar, overwritten is " +
        "true when an existing preset was replaced, version is the value written and versionSource " +
        "is \"vendor\" or \"fallback\", metadataWritten lists the metadata keys the installed file " +
        "carries, and note states that Bambu Studio sees the preset after a restart.\n\n" +
        "Errors: source missing or unparseable; schema violations listed per key; vendor or inherits " +
        "target not found; target exists without overwrite; target's 'from' is not \"User\" (refused " +
        "regardless of flags); the written preset is not loadable by Bambu Studio; config missing " +
        "(run init_config first).\n\n" +
        "Typical flow: write_profile into an outputDir, then import_profile with the same " +
        "outputDir/name. Check the source first with lint_profile, or read the settings it resolves " +
        "to with resolve_from_file. remove_profile deletes an installed user preset from " +
        "user/<userId>/<kind>/.",
      inputs: {
        kind:
          "Profile type to import; process and filament presets are the ones callers author, machine " +
          "presets stay Bambu Studio's",
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
        "Returns: { kind, name, removedJson, removedInfo, cloudRecord, note } — removedJson is the " +
        "deleted preset JSON's path and removedInfo the deleted sidecar's, null when no sidecar " +
        "existed; cloudRecord is true when the sidecar carried a populated setting_id; note states " +
        "that Bambu Studio sees the change after a restart, and adds the sync warning while " +
        "cloudRecord is true.\n\n" +
        "Errors: preset not found; a stray sidecar without its JSON; the preset's 'from' is not " +
        "\"User\" or its JSON is unparseable (refused regardless of flags); config missing (run " +
        "init_config first).\n\n" +
        "Discover installed user presets with list_profiles (source \"user\"). import_profile " +
        "installs a preset into the same store.",
      inputs: {
        kind:
          "Profile type to remove; process and filament presets are the ones callers install, " +
          "machine presets stay Bambu Studio's",
        name: "Name of the user preset to remove from user/<userId>/<kind>/",
      },
    },
    diffProfile: {
      title: "Diff profile",
      description:
        "Compare a profile file in a caller-chosen directory against the preset currently installed " +
        "in Bambu Studio's user preset store (user/<userId>/<kind>/), flat key by key. Reads back " +
        "values hand-tuned in Bambu Studio and surfaces drift between a project's profile files and " +
        "the installed presets. The comparison is flat over the keys each side declares itself, " +
        "'inherits' among them: a differing 'inherits' lands in changed as an ordinary key while each " +
        "side's parent chain stays outside the comparison. Identity and synthesized metadata (name, " +
        "from, version, settings ids) are skipped. kind and name locate the installed side under " +
        "user/<userId>/<kind>/, outputDir plus sourceName locate the file.\n\n" +
        "Returns: { kind, name, identical: boolean, changed: [{key, source, installed}], onlyInSource: " +
        "[{key, value}], onlyInstalled: [{key, value}], source: {path, modifiedAt}, installed: {path, " +
        "modifiedAt}, newer } — kind and name echo the arguments; identical is true exactly when " +
        "changed, onlyInSource and onlyInstalled are all empty, so keys both sides carry with equal " +
        "values stay out of the three arrays; source and installed carry each side's path plus its " +
        "modifiedAt, the file's ISO 8601 mtime, and newer says " +
        "which side changed last (\"source\", \"installed\", or \"same\").\n\n" +
        "Errors: source file missing or unparseable; preset absent from the user store; config " +
        "missing (run init_config first).\n\n" +
        "Sync drift back with update_profile (project file) or import_profile with overwrite " +
        "(installed preset). compare_profiles takes any two endpoints — a user preset, a vendor system " +
        "preset, or a local file — across process, filament, and machine profiles, and its mode " +
        "'resolved' compares the settings each side ends up with once its inherits chain is walked. " +
        "Discover installed user presets with list_profiles.",
      inputs: {
        kind:
          "Profile type to compare; compare_profiles covers machine profiles as well as process and " +
          "filament",
        name: "Name of the installed preset in user/<userId>/<kind>/",
        outputDir: "Directory containing the local profile file",
        sourceName:
          "Local file name (without .json) when it differs from the installed preset's name; omit it " +
          "and the file is read as <outputDir>/<name>.json",
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
        "Returns: { vendor, name, kind, chain: string[] (profile names, root-first, ending with the " +
        "name argument), settings: object, path, nilResolved?: object, nilUnresolved?: object, " +
        "missingKeys?: string[] } — vendor, name and kind echo the arguments, settings is the flat " +
        "merged key->value map matching resolve_profile's shape, and " +
        "path is the file that was read. A \"nil\" vector column carries the value its parent supplies " +
        "for that column, and settings shows that value: nilResolved maps key -> column indices filled " +
        "from a parent, nilUnresolved maps key -> column indices left as \"nil\". Each field appears " +
        "only when it has an entry. For most keys that parent is the next profile up the inherits " +
        "chain. The filament_* override family is the exception: its parent is the machine preset " +
        "supplied as machineName, matched by the key with the filament_ prefix stripped — supply " +
        "machineName to resolve those columns, and they stay \"nil\" under nilUnresolved whenever it " +
        "is absent. With keys given, settings carries exactly the " +
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
        sourceName:
          "Local file name (without .json) when it differs from name; omit it and the file is read " +
          "as <outputDir>/<name>.json",
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
    // Source: src/tools/compare.ts registerCompareTool(...)
    compareProfiles: {
      title: "Compare profiles",
      description:
        "Compare any two process, filament, or machine profiles against each other, flat key by key. " +
        "Each side is either a preset Bambu Studio has installed or the vendor ships, named by " +
        "'preset', or a profile file in a caller-chosen directory, named by 'outputDir' plus 'name'; " +
        "the two sides mix freely, so a file compares against a preset as readily as two presets " +
        "compare against each other. Mode 'resolved' compares the settings each side ends up with " +
        "once its 'inherits' chain is walked; mode 'raw' compares the keys each side declares itself. " +
        "Identity and synthesized metadata (name, from, version, settings ids) stay out of the " +
        "comparison; 'inherits' takes part in raw mode. Bambu Studio's directories stay untouched.\n\n" +
        "Returns: { mode, left: {label, path?}, right: {label, path?}, identical: boolean, changed: " +
        "[{key, left, right}], onlyLeft: [{key, value}], onlyRight: [{key, value}], note?: string } — " +
        "mode echoes the mode the comparison ran in; label names the endpoint and " +
        "path appears for a file endpoint, naming the file that was read. changed lists the keys both " +
        "sides carry with differing values, onlyLeft and onlyRight the keys one side carries alone; keys " +
        "both sides carry with equal values stay out of all three arrays and are reported only " +
        "through identical, which is true exactly when the three arrays are all empty. In " +
        "resolved mode a key a side takes from its inherits chain counts among that side's keys, so a " +
        "parent's key sits on both sides when the other side inherits it. The " +
        "note field appears when the compared values still held \"nil\" vector columns: those columns " +
        "were compared as the literal \"nil\", and machineName resolves the filament_* override " +
        "family's columns against a machine preset.\n\n" +
        "Errors: an endpoint's preset missing from the user and system stores; an endpoint's file " +
        "missing, unparseable, or, in resolved mode, lacking an 'inherits' field; vendor not found; " +
        "circular or unresolvable inherits chain; config missing (run init_config first). Each message " +
        "names the side it came from.\n\n" +
        "diff_profile answers the narrower question of whether one project file has drifted from the " +
        "installed preset of the same name, with file timestamps and a verdict on which side changed " +
        "last; compare_profiles takes any two endpoints. Discover names with list_profiles, and read " +
        "one side's settings in full with resolve_profile or resolve_from_file.",
      inputs: {
        kind: "Profile type both endpoints are read as",
        vendor:
          "Vendor id from list_vendors, e.g. 'BBL'; names the system store both endpoints resolve " +
          "their names and inherits chains against",
        left:
          "The endpoint reported as the left side: { preset: '<name>' } for an installed or system " +
          "preset, or { outputDir: '<directory>', name: '<file name without .json>' } for a local file",
        right:
          "The endpoint reported as the right side, in the same two shapes as left: { preset: " +
          "'<name>' } or { outputDir: '<directory>', name: '<file name without .json>' }",
        preset: "Exact name of a preset in the user store or the vendor's system profiles, from list_profiles",
        outputDir: "Directory containing the local profile file",
        name: "Local file name without .json; also the label this endpoint carries in the result",
        mode:
          "'resolved' compares the settings each side ends up with once its inherits chain is walked; " +
          "'raw' compares the keys each side declares itself. Defaults to 'resolved'",
        machineName:
          "Exact name of the machine preset whose columns the filament_* override family reads in " +
          "resolved mode, e.g. 'Bambu Lab X1 Carbon 0.4 nozzle'. Resolved under the same vendor. Give " +
          "it to compare what a \"nil\" column of filament_retraction_length, filament_wipe, or any " +
          "other filament_* override becomes on that printer; omit it to compare those columns as each " +
          "side states them, flagged in the result's note",
      },
    },
    // Source: src/tools/lint.ts registerLintTool(...)
    lintProfile: {
      title: "Lint profile",
      description:
        "Check a profile file in a caller-chosen directory for mechanical defects: overrides the " +
        "inherits chain already resolves to the same value, vector arrays whose column count differs " +
        "from the printer's, values whose shape contradicts the option schema, keys the schema lacks, " +
        "and \"nil\" columns that restate a value the file already spells out. Reads " +
        "<outputDir>/<name>.json and resolves its 'inherits' chain across the configured user preset " +
        "store and the vendor's system profiles. Bambu Studio's directories stay untouched.\n\n" +
        "Returns: { kind, name, path, clean, findings: [{ check, key, detail }], skipped: [{ check, " +
        "reason }] } — kind and name echo the arguments, path is the file that was read, and clean is " +
        "true when findings is empty. check is one of parent-equal-override, " +
        "column-count, scalar-vector-mismatch, unknown-key, nil-equals-parent; findings come grouped " +
        "by check in that order, by key within each. skipped names the checks this call had too " +
        "little information to run, each with the reason: column-count lands there whenever " +
        "machineName is omitted or the named machine preset states no printer_extruder_variant, so a " +
        "column count is reported only where a printer defines it.\n\n" +
        "Errors: file missing or unparseable; file lacking an 'inherits' field; vendor not found; " +
        "inherits target not found; circular or unresolvable inherits chain; machine preset not " +
        "found; config missing (run init_config first).\n\n" +
        "Fix a finding with update_profile (single keys) or write_profile (the whole override set), " +
        "then install the file with import_profile. To see the resulting values rather than the " +
        "defects, use resolve_from_file.",
      inputs: {
        kind:
          "Profile type to lint; selects the option schema the file's keys are checked against. " +
          "Machine profiles are readable through resolve_profile and resolve_from_file",
        vendor:
          "Vendor id from list_vendors, e.g. 'BBL'; names the system store the file's inherits chain " +
          "is resolved against",
        outputDir: "Directory containing the local profile file",
        name: "Name the linted profile carries; also the file name (<name>.json) unless sourceName says otherwise",
        sourceName:
          "Local file name (without .json) when it differs from name; omit it and the file is read " +
          "as <outputDir>/<name>.json",
        machineName:
          "Exact name of the machine preset the column count is measured against, e.g. 'Bambu Lab X1 " +
          "Carbon 0.4 nozzle'. Resolved under the same vendor; its printer_extruder_variant fixes how " +
          "many elements every vector option needs, and it supplies the columns the filament_* " +
          "override family's \"nil\" elements read. Omit it to have the column-count check reported " +
          "under skipped",
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
    studioRestartNote:
      "Bambu Studio reads user presets at startup, so it picks this up after a restart. A preset " +
      "whose compatible_printers excludes the selected machine stays hidden until that machine is selected.",
    cloudRecordWarning: "A cloud record exists for this preset; Bambu Studio's sync may restore it.",
    // Source: src/tools/import.ts handleImport
    importSourceNotFound: (path: string): string => `Source profile '${path}' not found. Create it with write_profile first.`,
    importSourceNotJson: (path: string): string => `Source profile '${path}' is not valid JSON.`,
    importSourceNotObject: (path: string): string => `Source profile '${path}' does not contain a JSON object.`,
    importSourceMissingInherits: (path: string): string => `Source profile '${path}' has no 'inherits' field.`,
    importMetadataWritten: (keys: string[]): string =>
      `Metadata written into the installed preset: ${keys.join(", ")}.`,
    importVersionFallback: (version: string, vendor: string): string =>
      `Vendor '${vendor}' supplies no usable bundle version, so the preset carries ${version}.`,
    importNotLoadable: (path: string, reason: string): string =>
      `Installed preset '${path}' ${reason} The file was written; remove it with remove_profile.`,
    importTargetExists: (path: string): string => `Target preset '${path}' already exists. Pass overwrite: true to replace it.`,
    importTargetUnparseable: (path: string): string =>
      `Refusing to overwrite '${path}': cannot verify it is a user preset (unparseable JSON).`,
    importTargetNotUser: (path: string): string => `Refusing to overwrite '${path}': its 'from' field is not "User".`,
    // Source: src/versions.ts evaluateLoadability
    versionMissingOrUnparseable: (value: unknown): string =>
      `carries no parseable version (${JSON.stringify(value)}); Bambu Studio skips such a preset silently.`,
    versionMajorAhead: (presetVersion: string, appVersion: string): string =>
      `version ${presetVersion} is a major version ahead of Bambu Studio ${appVersion}; Bambu Studio skips the preset.`,
    // Source: src/tools/diff.ts handleDiff
    diffSourceNotFound: (path: string): string => `Source profile '${path}' not found.`,
    diffSourceNotJson: (path: string): string => `Source profile '${path}' is not valid JSON.`,
    diffSourceNotObject: (path: string): string =>
      `Source profile '${path}' does not contain a JSON object.`,
    diffInstalledNotFound: (path: string): string =>
      `No preset installed at '${path}'. Install one with import_profile, or check the name with list_profiles.`,
    diffInstalledNotJson: (path: string): string => `Installed preset '${path}' is not valid JSON.`,
    diffInstalledNotObject: (path: string): string =>
      `Installed preset '${path}' does not contain a JSON object.`,
    // Source: src/tools/import.ts handleRemove
    removeStraySidecar: (jsonPath: string, infoPath: string): string =>
      `Preset JSON '${jsonPath}' is missing but a stray sidecar '${infoPath}' exists; nothing was removed.`,
    removeNotFound: (path: string): string => `Preset '${path}' not found in the user store.`,
    removeUnparseable: (path: string): string =>
      `Refusing to remove '${path}': cannot verify it is a user preset (unparseable JSON).`,
    removeNotObject: (path: string): string => `Preset '${path}' does not contain a JSON object.`,
    removeNotUser: (path: string): string => `Refusing to remove '${path}': its 'from' field is not "User".`,
    // Source: src/tools/resolve-from-file.ts handleResolveFromFile
    resolveFileNotFound: (path: string): string =>
      `Profile file '${path}' not found. Create it with write_profile first.`,
    resolveFileNotJson: (path: string): string => `Profile file '${path}' is not valid JSON.`,
    resolveFileNotObject: (path: string): string => `Profile file '${path}' does not contain a JSON object.`,
    resolveFileMissingInherits: (path: string): string =>
      `Profile file '${path}' has no 'inherits' field; resolution needs a parent profile to start from.`,
    // Source: src/tools/compare.ts handleCompare
    compareEndpointFailed: (side: "left" | "right", message: string): string =>
      `The ${side} endpoint could not be read: ${message}`,
    compareNilVerbatim: (keys: string[]): string =>
      `Vector columns still holding "nil" were compared verbatim: ${keys.join(", ")}. A "nil" column ` +
      `carries the value its parent supplies; pass machineName to resolve the filament_* override ` +
      `family's columns against a machine preset.`,
    // Source: src/tools/lint.ts handleLint — finding details and skipped reasons
    lintParentEqualOverride: (value: unknown): string =>
      `the inherits chain already resolves this key to ${JSON.stringify(value)}; the override is dead weight`,
    lintColumnCount: (actual: number, expected: number, machineName: string): string =>
      `the array carries ${actual} columns; '${machineName}' has ${expected}`,
    lintNilEqualsParent: (index: number, value: unknown, statedAt: number): string =>
      `column ${index} resolves to ${JSON.stringify(value)}, the value column ${statedAt} already states`,
    lintColumnCountNeedsMachine:
      "pass machineName to measure vector arrays against that printer's printer_extruder_variant.",
    lintColumnCountNoVariant: (machineName: string): string =>
      `machine preset '${machineName}' resolves printer_extruder_variant to a non-array value.`,
  },
  formats: {
    // Source: src/tools/deps.ts toToolError
    toolError: (message: string): string => `Error: ${message}`,
  },
} as const;

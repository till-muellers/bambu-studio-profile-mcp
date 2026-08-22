// Trimmed, structurally faithful excerpt of Preset.cpp's option-list declarations.
static std::vector<std::string> s_Preset_print_options {
    "layer_height", "wall_loops", "enable_support",
    "wall_generator", "outer_wall_speed"
};

static std::vector<std::string> s_Preset_filament_options {/*"filament_colour", */ "default_filament_colour", "filament_diameter",
    // BBS
    "nozzle_temperature", "filament_type"
};

const std::vector<std::string>& Preset::print_options()    { return s_Preset_print_options; }
const std::vector<std::string>& Preset::filament_options() { return s_Preset_filament_options; }

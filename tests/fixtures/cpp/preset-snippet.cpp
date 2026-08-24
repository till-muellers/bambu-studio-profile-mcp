// Trimmed, structurally faithful excerpt of Preset.cpp's option-list declarations.
static std::vector<std::string> s_Preset_print_options {
    "layer_height", "wall_loops", "enable_support",
    "wall_generator", "outer_wall_speed"
};

static std::vector<std::string> s_Preset_filament_options {/*"filament_colour", */ "default_filament_colour", "filament_diameter",
    // BBS
    "nozzle_temperature", "filament_type"
};

static std::vector<std::string> s_Preset_printer_options {
    "printer_technology",
    /*"bed_shape", */ "printable_area", "printer_model",
    // BBS
    "nozzle_type", "z_hop_types"
    // "legacy_option"
};

static std::vector<std::string> s_Preset_machine_limits_options {
    "machine_max_speed_x", "machine_max_speed_y",
};

const std::vector<std::string>& Preset::print_options()    { return s_Preset_print_options; }
const std::vector<std::string>& Preset::filament_options() { return s_Preset_filament_options; }
const std::vector<std::string>& Preset::machine_limits_options() { return s_Preset_machine_limits_options; }

const std::vector<std::string>& Preset::printer_options()
{
    static std::vector<std::string> s_opts;
    if (s_opts.empty()) {
        std::vector<std::string> opts = s_Preset_printer_options;
        append(opts, s_Preset_machine_limits_options);
        append(opts, Preset::nozzle_options());
        s_opts = opts;
    }
    return s_opts;
}

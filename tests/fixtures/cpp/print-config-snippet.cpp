// Trimmed, structurally faithful excerpt of PrintConfig.cpp definition blocks.
void PrintConfigDef::init_fff_params()
{
    ConfigOptionDef* def;

    def = this->add("layer_height", coFloat);
    def->label = L("Layer height");
    def->tooltip = L("Slicing height for each layer. Smaller layer height means more accurate and more printing time");
    def->min = 0.04;
    def->max = 1.0;
    def->set_default_value(new ConfigOptionFloat(0.2));

    def = this->add("wall_loops", coInt);
    def->label = L("Wall loops");
    def->min = 0;
    def->set_default_value(new ConfigOptionInt(2));

    def = this->add("enable_support", coBool);
    def->label = L("Enable support");
    def->tooltip = L("This is particularly helpful in the below scenarios:\n"
                     "1. To avoid changes in shine when printing glossy filaments\n"
                     "2. To avoid printing at speeds which cause VFAs on the external walls");
    def->set_default_value(new ConfigOptionBool(false));

    def = this->add("wall_generator", coEnum);
    def->enum_values.push_back("classic");
    def->enum_values.push_back("arachne");
    def->set_default_value(new ConfigOptionEnum<PerimeterGeneratorType>(PerimeterGeneratorType::Classic));

    def = this->add("outer_wall_speed", coFloats);
    def->label = L("Outer wall speed");
    def->tooltip = L("Speed of outer wall which is outermost and visible. It's used to be slower "
        "than inner wall speed to get better quality.");
    def->min = 0;
    def->set_default_value(new ConfigOptionFloats { 200 });

    def = this->add("nozzle_temperature", coInts);
    def->label = L("Nozzle temperature");
    def->tooltip = L("Nozzle temperature for layers except the initial one. "
        "Value 0 means the filament does not support to print on this nozzle");
    def->min = 0;
    def->max = 350;
    def->set_default_value(new ConfigOptionInts { 200 });

    def = this->add("override_process_overhang_speed", coBools);
    def->label = L("Override overhang speed");
    def->nullable = true;
    def->set_default_value(new ConfigOptionBoolsNullable({false}));

    def = this->add("precise_z_height", coBool);
    def->label = L("Precise Z height");
    def->set_default_value(new ConfigOptionBool(0));

    def = this->add("exclude_object", coBool);
    def->label = L("Exclude objects");
    def->set_default_value(new ConfigOptionBool(1));

    auto def_top_fill_pattern = def = this->add("top_surface_pattern", coEnum);
    def->label = L("Top surface pattern");
    def->enum_values.push_back("concentric");
    def->enum_values.push_back("zig-zag");
    def->set_default_value(new ConfigOptionEnum<InfillPattern>(ipRectilinear));

    def = this->add("bottom_surface_pattern", coEnum);
    def->label = L("Bottom surface pattern");
    def->enum_values = def_top_fill_pattern->enum_values;
    def->enum_labels = def_top_fill_pattern->enum_labels;
    def->set_default_value(new ConfigOptionEnum<InfillPattern>(ipRectilinear));

    def = this->add("brim_type", coEnum);
    def->label = L("Brim type");
    def->enum_values.emplace_back("auto_brim");
    def->enum_values.emplace_back("no_brim");
    def->set_default_value(new ConfigOptionEnum<BrimType>(btAutoBrim));

    def = this->add("filament_vendor", coStrings);
    def->label = L("Vendor");
    def->set_default_value(new ConfigOptionStrings{ L("(Undefined)") });

    def = this->add("filament_retraction_length", coFloats);
    def->label = L("Retraction length");
    def->tooltip = L("Retraction length before travel");
    def->nullable = true;
    def->set_default_value(new ConfigOptionFloatsNullable { 0.8 });
}

    def = this->add("retraction_length", coFloats);
    def->label = L("Retraction Length");
    def->min = 0;
    def->set_default_value(new ConfigOptionFloats { 0.8 });

    def = this->add("z_hop_types", coEnums);
    def->label = L("Z Hop Type");
    def->enum_values.push_back("Auto Lift");
    def->enum_values.push_back("Normal Lift");
    def->nullable = true;
    def->set_default_value(new ConfigOptionEnumsGenericNullable{ ZHopType::zhtSpiral });

    def = this->add("wipe", coBools);
    def->label = L("Wipe while retracting");
    def->set_default_value(new ConfigOptionBools { false });

    def = this->add("bridge_speed", coFloats);
    def->label = L("Bridge");
    def->min = 0;
    def->nullable = true;
    def->set_default_value(new ConfigOptionFloatsNullable{25});

const std::vector<std::string> filament_extruder_override_keys = {
    // floats
    "filament_retraction_length",
    "filament_z_hop_types",
    // bools
    "filament_wipe"
};

const std::vector<std::string> filament_overhang_override_keys = {
    "filament_bridge_speed"
};

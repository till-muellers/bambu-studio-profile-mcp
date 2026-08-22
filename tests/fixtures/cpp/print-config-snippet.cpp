// Trimmed, structurally faithful excerpt of PrintConfig.cpp definition blocks.
void PrintConfigDef::init_fff_params()
{
    ConfigOptionDef* def;

    def = this->add("layer_height", coFloat);
    def->label = L("Layer height");
    def->min = 0.04;
    def->max = 1.0;
    def->set_default_value(new ConfigOptionFloat(0.2));

    def = this->add("wall_loops", coInt);
    def->label = L("Wall loops");
    def->min = 0;
    def->set_default_value(new ConfigOptionInt(2));

    def = this->add("enable_support", coBool);
    def->label = L("Enable support");
    def->set_default_value(new ConfigOptionBool(false));

    def = this->add("wall_generator", coEnum);
    def->enum_values.push_back("classic");
    def->enum_values.push_back("arachne");
    def->set_default_value(new ConfigOptionEnum<PerimeterGeneratorType>(PerimeterGeneratorType::Classic));

    def = this->add("outer_wall_speed", coFloats);
    def->label = L("Outer wall speed");
    def->min = 0;
    def->set_default_value(new ConfigOptionFloats { 200 });

    def = this->add("nozzle_temperature", coInts);
    def->label = L("Nozzle temperature");
    def->min = 0;
    def->max = 350;
    def->set_default_value(new ConfigOptionInts { 200 });
}

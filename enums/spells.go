package enums

// SpellSchool is a D&D school of magic.
type SpellSchool string
type SpellLevel int16

const (
	SchoolAbjuration    SpellSchool = "abjuration"
	SchoolConjuration   SpellSchool = "conjuration"
	SchoolDivination    SpellSchool = "divination"
	SchoolEnchantment   SpellSchool = "enchantment"
	SchoolEvocation     SpellSchool = "evocation"
	SchoolIllusion      SpellSchool = "illusion"
	SchoolNecromancy    SpellSchool = "necromancy"
	SchoolTransmutation SpellSchool = "transmutation"
)

const (
	Cantrip SpellLevel = 0
	Level1  SpellLevel = 1
	Level2  SpellLevel = 2
	Level3  SpellLevel = 3
	Level4  SpellLevel = 4
	Level5  SpellLevel = 5
	Level6  SpellLevel = 6
	Level7  SpellLevel = 7
	Level8  SpellLevel = 8
	Level9  SpellLevel = 9
)

// SpellSchoolsEnum lists all valid schools of magic.
var SpellSchoolsEnum = []SpellSchool{
	SchoolAbjuration,
	SchoolConjuration,
	SchoolDivination,
	SchoolEnchantment,
	SchoolEvocation,
	SchoolIllusion,
	SchoolNecromancy,
	SchoolTransmutation,
}

// IsValid reports whether the value is a valid school of magic.
func (s SpellSchool) IsValid() bool {
	for _, v := range SpellSchoolsEnum {
		if v == s {
			return true
		}
	}
	return false
}

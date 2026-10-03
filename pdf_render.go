package main

// The character sheet as a PDF, in the spirit of the official 2024 sheet:
//
//   page 1 — identity, AC, Hit Points, Hit Dice, Death Saves, proficiency / initiative /
//            speed / inspiration; the six abilities with their saving throw and skills;
//            weapons, resources, conditions, training, senses, passive effects
//   page 2 — features & traits, actions, equipment, personality, appearance, notes
//            (two columns, more pages if needed)
//   page 3 — spellcasting: ability / DC / attack, spell slots, the spells by level
//
// Nothing is computed here: the frontend (pdfSheet.js) sends a ready "print model" with
// every number already worked out by the rules engine. This file only lays it out with
// go-pdf/fpdf, using the fonts embedded from assets/fonts (OFL, see the README there).
// It has no Wails dependency, so it can be tested on its own (renderSheetPDF).

import (
	"bytes"
	"embed"
	"encoding/base64"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"codeberg.org/go-pdf/fpdf"
)

//go:embed assets/fonts/*.ttf
var pdfFontsFS embed.FS

// ---------- the print model (pdfSheet.js) ----------

type SheetModel struct {
	V          num    `json:"v"`
	AppVersion string `json:"appVersion"`
	CreatedAt  string `json:"createdAt"`

	Name         string `json:"name"`
	Level        num    `json:"level"`
	ClassName    string `json:"className"`
	SubclassName string `json:"subclassName"`
	Species      string `json:"species"`
	Size         string `json:"size"`
	Background   string `json:"background"`
	Alignment    string `json:"alignment"`
	Portrait     string `json:"portrait"` // data:image/jpeg;base64,… or ""

	Abilities   []SheetAbility `json:"abilities"`
	Skills      []SheetSkill   `json:"skills"`
	Prof        string         `json:"prof"`
	AC          num            `json:"ac"`
	ArmorLine   string         `json:"armorLine"`
	Initiative  string         `json:"initiative"`
	Speed       string         `json:"speed"`
	HPMax       num            `json:"hpMax"`
	HPCurrent   num            `json:"hpCurrent"`
	HPTemp      num            `json:"hpTemp"`
	HitDice     string         `json:"hitDice"`
	HitDiceLeft num            `json:"hitDiceLeft"`
	DeathSaves  struct {
		Success num `json:"success"`
		Fail    num `json:"fail"`
	} `json:"deathSaves"`
	Inspiration       bool              `json:"inspiration"`
	PassivePerception num               `json:"passivePerception"`
	Darkvision        string            `json:"darkvision"`
	AttackCount       num               `json:"attackCount"`
	AttackNote        string            `json:"attackNote"` // "2 with the pact weapon"
	Attacks           []SheetAttack     `json:"attacks"`
	Resources         []SheetResource   `json:"resources"`
	Effects           []SheetTextGroup  `json:"effects"`
	Conditions        []string          `json:"conditions"`
	Proficiencies     []SheetLabelValue `json:"proficiencies"`

	Features  []SheetItemGroup `json:"features"`
	Actions   []SheetItemGroup `json:"actions"`
	Equipment []SheetEquip     `json:"equipment"`
	Bio       []SheetBioGroup  `json:"bio"`
	Notes     string           `json:"notes"`

	Casting []SheetCasting   `json:"casting"`
	Slots   []SheetSlot      `json:"slots"`
	Spells  []SheetItemGroup `json:"spells"`
}

type SheetAbility struct {
	Key      string `json:"key"`
	Name     string `json:"name"`
	Short    string `json:"short"`
	Score    num    `json:"score"`
	Mod      string `json:"mod"`
	Save     string `json:"save"`
	SaveProf bool   `json:"saveProf"`
}

type SheetSkill struct {
	Name    string `json:"name"`
	Ability string `json:"ability"` // STR, DEX…
	Value   string `json:"value"`
	Prof    bool   `json:"prof"`
	Expert  bool   `json:"expert"`
}

type SheetAttack struct {
	Name   string `json:"name"`
	Bonus  string `json:"bonus"`
	Damage string `json:"damage"`
	Notes  string `json:"notes"`
}

type SheetResource struct {
	Name     string `json:"name"`
	Max      num    `json:"max"`
	Left     num    `json:"left"`
	Recharge string `json:"recharge"`
}

type SheetTextGroup struct {
	Title string   `json:"title"`
	Items []string `json:"items"`
}

type SheetLabelValue struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

type SheetItem struct {
	Name   string `json:"name"`
	Meta   string `json:"meta"`
	Level  *num   `json:"level"`
	Tags   string `json:"tags"`
	Damage string `json:"damage"`
	Action string `json:"action"`
	Note   string `json:"note"`
	Source string `json:"source"`
	Desc   string `json:"desc"`
}

type SheetItemGroup struct {
	Title string      `json:"title"`
	Items []SheetItem `json:"items"`
}

type SheetEquip struct {
	Name string `json:"name"`
	Qty  num    `json:"qty"`
	Tag  string `json:"tag"`
}

type SheetBioGroup struct {
	Title  string            `json:"title"`
	Fields []SheetLabelValue `json:"fields"`
}

type SheetCasting struct {
	Title   string `json:"title"`
	Ability string `json:"ability"`
	DC      *num   `json:"dc"`
	Attack  string `json:"attack"`
}

type SheetSlot struct {
	Level num  `json:"level"`
	Max   num  `json:"max"`
	Used  num  `json:"used"`
	Pact  bool `json:"pact"`
}

// num: an integer that also accepts 2.0 / "2" / null from JSON (a stray float
// in the model must not cost the whole PDF).
type num int

func (n *num) UnmarshalJSON(b []byte) error {
	t := strings.Trim(strings.TrimSpace(string(b)), `"`)
	if t == "" || t == "null" {
		*n = 0
		return nil
	}
	var f float64
	if _, err := fmt.Sscan(t, &f); err != nil {
		*n = 0 // not a number: print 0 rather than fail
		return nil
	}
	*n = num(math.Round(f))
	return nil
}

// ---------- page geometry and colors (mm) ----------

const (
	pgW     = 210.0
	pgH     = 297.0
	pgM     = 10.0        // margins
	pgBot   = pgH - 12.0  // bottom of the content (the footer is below)
	contW   = pgW - 2*pgM // content width
	boxR    = 1.6         // rounded corners
	ptToMM  = 0.3528      // 1 pt in mm
	lineFac = 1.22        // line height / font size
)

type rgb struct{ r, g, b int }

var (
	colInk    = rgb{29, 26, 23}
	colMuted  = rgb{122, 114, 104}
	colAccent = rgb{143, 106, 42}
	colBorder = rgb{190, 180, 166}
	colFill   = rgb{245, 241, 234}
	colWhite  = rgb{255, 255, 255}
)

// font families (registered in newSheetPDF)
const (
	fTitle = "cinzel"   // only "B"; Latin only — fixed English labels
	fUI    = "inter"    // "", "B", "I"
	fText  = "garamond" // "", "B", "I"
)

type sheetPDF struct {
	f *fpdf.Fpdf
	m *SheetModel
}

// renderSheetPDF lays out the model and returns the PDF bytes.
func renderSheetPDF(m *SheetModel) ([]byte, error) {
	f := fpdf.New("P", "mm", "A4", "")
	f.SetMargins(pgM, pgM, pgM)
	f.SetAutoPageBreak(false, 0)
	f.SetCompression(true)
	for _, ft := range []struct{ family, style, file string }{
		{fTitle, "B", "Cinzel-Bold.ttf"},
		{fUI, "", "Inter-Regular.ttf"},
		{fUI, "B", "Inter-Bold.ttf"},
		{fUI, "I", "Inter-Italic.ttf"},
		{fText, "", "EBGaramond-Regular.ttf"},
		{fText, "B", "EBGaramond-Bold.ttf"},
		{fText, "I", "EBGaramond-Italic.ttf"},
	} {
		b, err := pdfFontsFS.ReadFile("assets/fonts/" + ft.file)
		if err != nil {
			return nil, fmt.Errorf("pdf font %s: %w", ft.file, err)
		}
		f.AddUTF8FontFromBytes(ft.family, ft.style, b)
	}
	title := strings.TrimSpace(m.Name)
	if title == "" {
		title = "Character"
	}
	f.SetTitle(title+" — character sheet", true)
	f.SetSubject(strings.TrimSpace(fmt.Sprintf("Level %d %s", m.Level, m.ClassName)), true)
	f.SetCreator("DnD Builder "+m.AppVersion, true)
	f.SetCreationDate(time.Now())

	s := &sheetPDF{f: f, m: m}
	f.SetFooterFunc(s.footer)

	s.page1()
	s.page2()
	if len(m.Casting) > 0 || len(m.Spells) > 0 || len(m.Slots) > 0 {
		s.page3()
	}
	if err := f.Error(); err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if err := f.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// ---------- drawing helpers ----------

func (s *sheetPDF) color(c rgb) { s.f.SetTextColor(c.r, c.g, c.b) }
func (s *sheetPDF) draw(c rgb)  { s.f.SetDrawColor(c.r, c.g, c.b) }
func (s *sheetPDF) fill(c rgb)  { s.f.SetFillColor(c.r, c.g, c.b) }
func (s *sheetPDF) font(fam, st string, size float64) {
	s.f.SetFont(fam, st, size)
}
func lineH(size float64) float64 { return size * ptToMM * lineFac }

func (s *sheetPDF) width(t string) float64 { return s.f.GetStringWidth(t) }

// text at a baseline
func (s *sheetPDF) text(x, y float64, t string) { s.f.Text(x, y, t) }
func (s *sheetPDF) textR(xr, y float64, t string) {
	s.f.Text(xr-s.width(t), y, t)
}
func (s *sheetPDF) textC(cx, y float64, t string) {
	s.f.Text(cx-s.width(t)/2, y, t)
}

// fit shortens t with "…" so it fits w.
func (s *sheetPDF) fit(t string, w float64) string {
	if s.width(t) <= w {
		return t
	}
	r := []rune(t)
	for len(r) > 0 && s.width(string(r)+"…") > w {
		r = r[:len(r)-1]
	}
	return strings.TrimRight(string(r), " ,·") + "…"
}

// wrap splits t into lines no wider than w (the current font); keeps "\n" breaks.
func (s *sheetPDF) wrap(t string, w float64) []string {
	var out []string
	for _, para := range strings.Split(strings.ReplaceAll(t, "\r", ""), "\n") {
		para = strings.TrimRight(para, " ")
		if strings.TrimSpace(para) == "" {
			out = append(out, "")
			continue
		}
		line := ""
		for _, word := range strings.Fields(para) {
			try := word
			if line != "" {
				try = line + " " + word
			}
			if s.width(try) <= w {
				line = try
				continue
			}
			if line != "" {
				out = append(out, line)
				line = ""
			}
			// a word longer than the line: cut it
			for s.width(word) > w && utf8.RuneCountInString(word) > 1 {
				r := []rune(word)
				n := len(r) - 1
				for n > 1 && s.width(string(r[:n])) > w {
					n--
				}
				out = append(out, string(r[:n]))
				word = string(r[n:])
			}
			line = word
		}
		if line != "" {
			out = append(out, line)
		}
	}
	// no blank lines at the ends
	for len(out) > 0 && out[0] == "" {
		out = out[1:]
	}
	for len(out) > 0 && out[len(out)-1] == "" {
		out = out[:len(out)-1]
	}
	return out
}

// box: a rounded frame; title (small caps) at the top left. Returns the y where content starts.
func (s *sheetPDF) box(x, y, w, h float64, title string) float64 {
	s.draw(colBorder)
	s.f.SetLineWidth(0.3)
	s.fill(colWhite)
	s.f.RoundedRect(x, y, w, h, boxR, "1234", "D")
	if title == "" {
		return y + 2
	}
	s.label(x+2.4, y+3.9, title, w-4.8, 6.2)
	return y + 6
}

// label: a small caps title (Cinzel), shrunk to fit w.
func (s *sheetPDF) label(x, y float64, t string, w, size float64) {
	t = strings.ToUpper(t)
	s.color(colAccent)
	for size > 4 {
		s.font(fTitle, "B", size)
		if s.width(t) <= w {
			break
		}
		size -= 0.25
	}
	s.text(x, y, s.fit(t, w))
	s.color(colInk)
}

func (s *sheetPDF) labelC(cx, y float64, t string, w, size float64) {
	t = strings.ToUpper(t)
	s.color(colAccent)
	for size > 4 {
		s.font(fTitle, "B", size)
		if s.width(t) <= w {
			break
		}
		size -= 0.25
	}
	t = s.fit(t, w)
	s.textC(cx, y, t)
	s.color(colInk)
}

// dot: a proficiency circle — empty, filled, or filled with a ring (expertise).
func (s *sheetPDF) dot(cx, cy float64, filled, ring bool) {
	s.draw(colInk)
	s.f.SetLineWidth(0.22)
	if filled {
		s.fill(colInk)
		s.f.Circle(cx, cy, 0.95, "FD")
	} else {
		s.f.Circle(cx, cy, 0.95, "D")
	}
	if ring {
		s.f.Circle(cx, cy, 1.45, "D")
	}
}

// checkbox: a small square, filled if on.
func (s *sheetPDF) checkbox(x, y, size float64, on bool) {
	s.draw(colInk)
	s.f.SetLineWidth(0.22)
	if on {
		s.fill(colInk)
		s.f.Rect(x, y, size, size, "FD")
	} else {
		s.f.Rect(x, y, size, size, "D")
	}
}

func (s *sheetPDF) hline(x1, x2, y float64, c rgb, w float64) {
	s.draw(c)
	s.f.SetLineWidth(w)
	s.f.Line(x1, y, x2, y)
}

// ---------- page frame ----------

func (s *sheetPDF) footer() {
	m := s.m
	s.font(fUI, "", 6.2)
	s.color(colMuted)
	left := strings.TrimSpace(fmt.Sprintf("%s · Level %d %s", m.Name, m.Level, m.ClassName))
	s.text(pgM, pgH-6, s.fit(left, contW*0.6))
	right := fmt.Sprintf("DnD Builder %s · %s · page %d", m.AppVersion, createdDate(m.CreatedAt), s.f.PageNo())
	right = strings.ReplaceAll(right, "  ", " ")
	s.textR(pgW-pgM, pgH-6, right)
	s.color(colInk)
}

func createdDate(iso string) string {
	if t, err := time.Parse(time.RFC3339, iso); err == nil {
		return t.Local().Format("2006-01-02")
	}
	return time.Now().Format("2006-01-02")
}

// runningHeader: the small name line on pages 2+. Returns the y where content starts.
func (s *sheetPDF) runningHeader(title string) float64 {
	m := s.m
	s.font(fText, "B", 13)
	s.color(colInk)
	s.text(pgM, pgM+5, s.fit(m.Name, contW*0.55))
	s.font(fUI, "", 7.5)
	s.color(colMuted)
	sub := strings.Trim(strings.Join(nonEmpty(fmt.Sprintf("Level %d %s", m.Level, m.ClassName), m.SubclassName), " · "), " ")
	s.textR(pgW-pgM, pgM+5, s.fit(sub, contW*0.4))
	s.hline(pgM, pgW-pgM, pgM+7.5, colAccent, 0.4)
	s.label(pgM, pgM+12.5, title, contW, 9)
	return pgM + 16
}

func nonEmpty(xs ...string) []string {
	var out []string
	for _, x := range xs {
		if strings.TrimSpace(x) != "" {
			out = append(out, x)
		}
	}
	return out
}

// ---------- page 1 ----------

func (s *sheetPDF) page1() {
	f, m := s.f, s.m
	f.AddPage()

	// --- identity: portrait | name + fields | AC shield ---
	const topH = 34.0
	x := pgM
	if img := s.portrait(); img != "" {
		s.image(img, x, pgM, topH, topH)
		x += topH + 4
	}
	shieldW := 24.0
	idW := pgW - pgM - shieldW - 4 - x

	s.font(fText, "B", 21)
	s.color(colInk)
	s.text(x, pgM+8.2, s.fit(m.Name, idW))
	s.hline(x, x+idW, pgM+10.2, colBorder, 0.3)
	s.label(x, pgM+13.2, "Character name", idW, 5.4)

	fields := [][]SheetLabelValue{
		{{"Class", m.ClassName}, {"Subclass", m.SubclassName}, {"Level", fmt.Sprint(m.Level)}},
		{{"Species", m.Species}, {"Background", m.Background}, {"Alignment", m.Alignment}},
	}
	parts := []float64{0.4, 0.42, 0.18}
	for row, fs := range fields {
		y := pgM + 20.5 + float64(row)*9.4
		fx := x
		for i, fl := range fs {
			w := idW*parts[i] - 2.5
			s.font(fUI, "", 8.6)
			s.color(colInk)
			s.text(fx, y, s.fit(fl.Value, w))
			s.hline(fx, fx+w, y+1.5, colBorder, 0.25)
			s.label(fx, y+4.4, fl.Label, w, 5.2)
			fx += idW * parts[i]
		}
	}

	// AC shield
	sx := pgW - pgM - shieldW
	s.shield(sx, pgM, shieldW, topH-2, int(m.AC))

	// --- vitals row ---
	y := pgM + topH + 3
	const vh = 19.0
	gap := 2.2
	widths := []float64{46, 24, 32, 20, 20, 22}
	used := 0.0
	for _, w := range widths {
		used += w + gap
	}
	inspW := contW - used
	bx := pgM
	s.hpBox(bx, y, widths[0], vh)
	bx += widths[0] + gap
	s.hitDiceBox(bx, y, widths[1], vh)
	bx += widths[1] + gap
	s.deathBox(bx, y, widths[2], vh)
	bx += widths[2] + gap
	s.statBox(bx, y, widths[3], vh, "Proficiency", m.Prof, "bonus")
	bx += widths[3] + gap
	s.statBox(bx, y, widths[4], vh, "Initiative", m.Initiative, "")
	bx += widths[4] + gap
	s.statBox(bx, y, widths[5], vh, "Speed", m.Speed, m.Size)
	bx += widths[5] + gap
	s.inspirationBox(bx, y, inspW, vh)

	// --- abilities: two columns of three ---
	y += vh + 3
	colW := 50.0
	leftX := pgM
	rightX := pgM + colW*2 + 3 + 3
	rightW := pgW - pgM - rightX
	ya, yb := y, y
	byKey := map[string]SheetAbility{}
	for _, a := range m.Abilities {
		byKey[a.Key] = a
	}
	for _, k := range []string{"str", "dex", "con"} {
		if a, ok := byKey[k]; ok {
			ya += s.abilityBox(leftX, ya, colW, a) + 2.5
		}
	}
	for _, k := range []string{"int", "wis", "cha"} {
		if a, ok := byKey[k]; ok {
			yb += s.abilityBox(leftX+colW+3, yb, colW, a) + 2.5
		}
	}

	// --- left column below the abilities: training, senses, effects ---
	ly := math.Max(ya, yb) + 0.5
	lw := colW*2 + 3
	ly = s.trainingBox(leftX, ly, lw)
	s.effectsBox(leftX, ly+2.5, lw, pgBot-(ly+2.5))

	// --- right column: weapons, resources, conditions ---
	ry := s.weaponsBox(rightX, y, rightW)
	ry = s.resourcesBox(rightX, ry+2.5, rightW)
	s.conditionsBox(rightX, ry+2.5, rightW, pgBot-(ry+2.5))
}

// portrait: the registered image name ("" if there is none or it can't be read).
func (s *sheetPDF) portrait() string {
	p := s.m.Portrait
	i := strings.Index(p, ";base64,")
	if !strings.HasPrefix(p, "data:image/") || i < 0 {
		return ""
	}
	mime := p[len("data:image/"):i]
	typ := map[string]string{"jpeg": "JPG", "jpg": "JPG", "png": "PNG", "gif": "GIF"}[mime]
	if typ == "" {
		return ""
	}
	raw, err := base64.StdEncoding.DecodeString(p[i+len(";base64,"):])
	if err != nil || len(raw) == 0 {
		return ""
	}
	info := s.f.RegisterImageOptionsReader("portrait", fpdf.ImageOptions{ImageType: typ}, bytes.NewReader(raw))
	if s.f.Err() || info == nil {
		s.f.ClearError()
		return ""
	}
	return "portrait"
}

// image: drawn to cover the w×h frame (cropped), with rounded corners and a border.
func (s *sheetPDF) image(name string, x, y, w, h float64) {
	info := s.f.GetImageInfo(name)
	if info == nil {
		return
	}
	iw, ih := info.Width(), info.Height()
	if iw <= 0 || ih <= 0 {
		return
	}
	k := math.Max(w/iw, h/ih)
	dw, dh := iw*k, ih*k
	s.f.ClipRoundedRect(x, y, w, h, boxR, false)
	s.f.ImageOptions(name, x+(w-dw)/2, y+(h-dh)/2, dw, dh, false, fpdf.ImageOptions{}, 0, "")
	s.f.ClipEnd()
	s.draw(colBorder)
	s.f.SetLineWidth(0.3)
	s.f.RoundedRect(x, y, w, h, boxR, "1234", "D")
}

// shield: the Armor Class badge.
func (s *sheetPDF) shield(x, y, w, h float64, ac int) {
	pts := []fpdf.PointType{
		{X: x, Y: y + 2.5}, {X: x + w/2, Y: y}, {X: x + w, Y: y + 2.5},
		{X: x + w, Y: y + h*0.55}, {X: x + w/2, Y: y + h}, {X: x, Y: y + h*0.55},
	}
	s.draw(colAccent)
	s.fill(colFill)
	s.f.SetLineWidth(0.5)
	s.f.Polygon(pts, "FD")
	s.font(fUI, "B", 19)
	s.color(colInk)
	s.textC(x+w/2, y+h*0.47, fmt.Sprint(ac))
	s.labelC(x+w/2, y+h*0.64, "Armor", w-4, 5.6)
	s.labelC(x+w/2, y+h*0.64+2.4, "Class", w-4, 5.6)
}

// statBox: a small box with a big value (Proficiency, Initiative, Speed).
func (s *sheetPDF) statBox(x, y, w, h float64, title, value, sub string) {
	s.box(x, y, w, h, "")
	s.labelC(x+w/2, y+4, title, w-3, 5.8)
	size := 14.0
	s.font(fUI, "B", size)
	for size > 8 && s.width(value) > w-3 {
		size -= 0.5
		s.font(fUI, "B", size)
	}
	s.color(colInk)
	s.textC(x+w/2, y+11.8, value)
	if sub != "" {
		s.font(fUI, "", 6)
		s.color(colMuted)
		s.textC(x+w/2, y+h-2.2, s.fit(sub, w-2))
		s.color(colInk)
	}
}

func (s *sheetPDF) hpBox(x, y, w, h float64) {
	m := s.m
	s.box(x, y, w, h, "")
	s.labelC(x+w/2, y+4, "Hit Points", w-4, 6)
	cw := w / 3
	cells := []struct {
		label string
		value string
		big   bool
	}{
		{"Current", fmt.Sprint(m.HPCurrent), true},
		{"Max", fmt.Sprint(m.HPMax), false},
		{"Temp", tempText(int(m.HPTemp)), false},
	}
	for i, c := range cells {
		cx := x + cw*float64(i) + cw/2
		if c.big {
			s.font(fUI, "B", 14)
		} else {
			s.font(fUI, "B", 10.5)
		}
		s.color(colInk)
		s.textC(cx, y+11.8, c.value)
		s.font(fUI, "", 5.6)
		s.color(colMuted)
		s.textC(cx, y+h-2.4, strings.ToUpper(c.label))
		if i > 0 {
			s.draw(colBorder)
			s.f.SetLineWidth(0.2)
			s.f.Line(x+cw*float64(i), y+6.5, x+cw*float64(i), y+h-1.8)
		}
	}
	s.color(colInk)
}

func tempText(n int) string {
	if n <= 0 {
		return "—"
	}
	return fmt.Sprint(n)
}

func (s *sheetPDF) hitDiceBox(x, y, w, h float64) {
	m := s.m
	s.box(x, y, w, h, "")
	s.labelC(x+w/2, y+4, "Hit Dice", w-3, 6)
	s.font(fUI, "B", 12)
	s.color(colInk)
	s.textC(x+w/2, y+11.8, m.HitDice)
	s.font(fUI, "", 6)
	s.color(colMuted)
	s.textC(x+w/2, y+h-2.2, fmt.Sprintf("%d left", m.HitDiceLeft))
	s.color(colInk)
}

func (s *sheetPDF) deathBox(x, y, w, h float64) {
	m := s.m
	s.box(x, y, w, h, "")
	s.labelC(x+w/2, y+4, "Death Saves", w-3, 6)
	rows := []struct {
		label string
		n     int
	}{{"Successes", int(m.DeathSaves.Success)}, {"Failures", int(m.DeathSaves.Fail)}}
	for i, r := range rows {
		ry := y + 9.6 + float64(i)*5.2
		s.font(fUI, "", 5.8)
		s.color(colMuted)
		s.text(x+2.2, ry+0.9, strings.ToUpper(r.label))
		for k := 0; k < 3; k++ {
			s.dot(x+w-10.4+float64(k)*3.6, ry, k < r.n, false)
		}
	}
	s.color(colInk)
}

func (s *sheetPDF) inspirationBox(x, y, w, h float64) {
	s.box(x, y, w, h, "")
	s.labelC(x+w/2, y+4, "Heroic", w-2, 5.4)
	s.labelC(x+w/2, y+6.4, "Inspiration", w-2, 5.4)
	size := math.Min(5, w-6)
	s.draw(colInk)
	s.f.SetLineWidth(0.3)
	if s.m.Inspiration {
		s.fill(colAccent)
		s.f.RoundedRect(x+w/2-size/2, y+9.6, size, size, 0.8, "1234", "FD")
	} else {
		s.f.RoundedRect(x+w/2-size/2, y+9.6, size, size, 0.8, "1234", "D")
	}
}

// abilityBox: modifier + score on the left, the saving throw and skills on the right.
// Returns the height.
func (s *sheetPDF) abilityBox(x, y, w float64, a SheetAbility) float64 {
	m := s.m
	var skills []SheetSkill
	for _, sk := range m.Skills {
		if strings.EqualFold(sk.Ability, a.Short) {
			skills = append(skills, sk)
		}
	}
	const rowH = 4.25
	rows := 1 + len(skills)
	h := 6.4 + math.Max(16.2, float64(rows)*rowH+0.6) + 1.2
	s.box(x, y, w, h, "")
	s.label(x+2.4, y+4.1, a.Name, w-4.8, 7)

	// modifier + score
	lw := 12.6
	cx := x + 1.6 + lw/2
	s.draw(colBorder)
	s.fill(colFill)
	s.f.SetLineWidth(0.25)
	s.f.RoundedRect(x+1.6, y+6.2, lw, 11.2, 1.4, "1234", "FD")
	s.font(fUI, "B", 15)
	s.color(colInk)
	s.textC(cx, y+14.4, a.Mod)
	s.fill(colWhite)
	s.f.RoundedRect(cx-5, y+15.6, 10, 4.8, 2.2, "1234", "FD")
	s.font(fUI, "B", 7.6)
	s.textC(cx, y+19.1, fmt.Sprint(a.Score))

	// saving throw + skills
	rx := x + lw + 3.6
	ry := y + 9.2
	row := func(name, value string, prof, expert, italic bool) {
		s.dot(rx+0.9, ry-1.05, prof, expert)
		s.font(fUI, "B", 7.2)
		s.color(colInk)
		s.textR(rx+8.6, ry, value)
		st := ""
		if italic {
			st = "I"
		}
		s.font(fUI, st, 7)
		s.text(rx+9.6, ry, s.fit(name, x+w-1.8-(rx+9.6)))
		ry += rowH
	}
	row("Saving Throw", a.Save, a.SaveProf, false, true)
	for _, sk := range skills {
		row(sk.Name, sk.Value, sk.Prof, sk.Expert, false)
	}
	return h
}

// trainingBox: armor / weapons / tools training + senses. Returns the bottom y.
func (s *sheetPDF) trainingBox(x, y, w float64) float64 {
	m := s.m
	type line struct{ label, value string }
	var lines []line
	for _, p := range m.Proficiencies {
		lines = append(lines, line{p.Label, p.Value})
	}
	senses := []string{fmt.Sprintf("Passive Perception %d", m.PassivePerception)}
	if m.Darkvision != "" {
		senses = append(senses, "Darkvision "+m.Darkvision)
	}
	lines = append(lines, line{"Senses", strings.Join(senses, " · ")})

	inner := w - 4.8
	s.font(fUI, "", 7.2)
	var wrapped [][]string
	total := 0
	for _, l := range lines {
		s.font(fUI, "B", 7.2)
		lab := l.label + ": "
		lw := s.width(lab)
		s.font(fUI, "", 7.2)
		ws := s.wrap(l.value, inner-lw)
		if len(ws) == 0 {
			ws = []string{"—"}
		}
		wrapped = append(wrapped, ws)
		total += len(ws)
	}
	lh := lineH(7.2)
	h := 6 + float64(total)*lh + 2
	top := s.box(x, y, w, h, "Training & senses")
	ty := top + lh - 0.6
	for i, l := range lines {
		s.font(fUI, "B", 7.2)
		s.color(colInk)
		lab := l.label + ": "
		s.text(x+2.4, ty, lab)
		lw := s.width(lab)
		s.font(fUI, "", 7.2)
		for _, wl := range wrapped[i] {
			s.text(x+2.4+lw, ty, wl)
			ty += lh
		}
	}
	return y + h
}

// effectsBox: resistances, senses, advantages… from features (Character.passives.effects).
func (s *sheetPDF) effectsBox(x, y, w, h float64) {
	m := s.m
	top := s.box(x, y, w, h, "Passive effects")
	inner := w - 4.8
	lh := lineH(7)
	ty := top + lh - 0.6
	bottom := y + h - 1.5
	if len(m.Effects) == 0 {
		s.font(fUI, "I", 7)
		s.color(colMuted)
		s.text(x+2.4, ty, "—")
		s.color(colInk)
		return
	}
	for _, g := range m.Effects {
		s.font(fUI, "B", 7)
		lab := g.Title + ": "
		lw := s.width(lab)
		s.font(fUI, "", 7)
		ws := s.wrap(strings.Join(g.Items, "; "), inner-lw)
		if ty > bottom {
			break
		}
		s.font(fUI, "B", 7)
		s.color(colInk)
		s.text(x+2.4, ty, lab)
		s.font(fUI, "", 7)
		for i, wl := range ws {
			if ty > bottom {
				break
			}
			if ty+lh > bottom && i < len(ws)-1 {
				wl = s.fit(wl+" …", inner-lw)
			}
			s.text(x+2.4+lw, ty, wl)
			ty += lh
		}
		ty += 0.6
	}
}

// weaponsBox: weapons & damage cantrips. Returns the bottom y.
func (s *sheetPDF) weaponsBox(x, y, w float64) float64 {
	m := s.m
	type row struct{ name, bonus, damage, notes string }
	var rows []row
	for _, a := range m.Attacks {
		rows = append(rows, row{a.Name, a.Bonus, a.Damage, a.Notes})
	}
	// cantrips that deal damage go here too, as on the official sheet
	for _, g := range m.Spells {
		for _, it := range g.Items {
			if it.Level != nil && *it.Level == 0 && it.Damage != "" {
				rows = append(rows, row{it.Name, "", it.Damage, "Cantrip" + prefixDot(it.Action)})
			}
		}
	}
	const rowH = 5.0
	n := len(rows)
	if n < 5 {
		n = 5
	}
	footer := 2
	h := 6 + 4.2 + float64(n)*rowH + float64(footer)*3.6 + 2
	top := s.box(x, y, w, h, "Weapons & damage cantrips")
	iw := w - 4.8
	cols := []float64{iw * 0.32, iw * 0.1, iw * 0.33, iw * 0.25}
	heads := []string{"Name", "Atk", "Damage & type", "Notes"}
	cx := x + 2.4
	for i, hd := range heads {
		s.font(fUI, "B", 5.8)
		s.color(colMuted)
		s.text(cx, top+2.6, strings.ToUpper(hd))
		cx += cols[i]
	}
	s.color(colInk)
	ry := top + 4.2
	for i := 0; i < n; i++ {
		s.hline(x+2.4, x+w-2.4, ry, colBorder, 0.15)
		if i < len(rows) {
			r := rows[i]
			cx := x + 2.4
			vals := []string{r.name, r.bonus, r.damage, r.notes}
			for j, v := range vals {
				switch j {
				case 0:
					s.font(fText, "B", 8.6)
				case 1:
					s.font(fUI, "B", 7.6)
				case 3:
					s.font(fUI, "I", 6.4)
				default:
					s.font(fUI, "", 7.2)
				}
				s.text(cx, ry+3.6, s.fit(v, cols[j]-1.6))
				cx += cols[j]
			}
		}
		ry += rowH
	}
	s.hline(x+2.4, x+w-2.4, ry, colBorder, 0.15)
	ry += 3.6
	s.font(fUI, "", 6.8)
	s.color(colMuted)
	attacks := m.AttackCount
	if attacks < 1 {
		attacks = 1
	}
	per := fmt.Sprintf("Attacks per Attack action: %d", attacks)
	if m.AttackNote != "" {
		per += " (" + m.AttackNote + ")"
	}
	s.text(x+2.4, ry, s.fit(per, w-4.8))
	ry += 3.6
	s.text(x+2.4, ry, s.fit("Armor: "+m.ArmorLine, w-4.8))
	s.color(colInk)
	return y + h
}

func prefixDot(s string) string {
	if s == "" {
		return ""
	}
	return " · " + s
}

// resourcesBox: class resources with checkboxes. Returns the bottom y.
func (s *sheetPDF) resourcesBox(x, y, w float64) float64 {
	m := s.m
	const rowH = 5.2
	n := len(m.Resources)
	if n == 0 {
		n = 1
	}
	h := 6 + float64(n)*rowH + 1.6
	top := s.box(x, y, w, h, "Class resources")
	ry := top + 3.4
	if len(m.Resources) == 0 {
		s.font(fUI, "I", 7)
		s.color(colMuted)
		s.text(x+2.4, ry, "—")
		s.color(colInk)
		return y + h
	}
	for _, r := range m.Resources {
		s.font(fText, "B", 8.6)
		s.color(colInk)
		nameW := w * 0.42
		s.text(x+2.4, ry, s.fit(r.Name, nameW-1))
		s.font(fUI, "", 6)
		s.color(colMuted)
		rech := r.Recharge
		s.text(x+2.4+nameW, ry, s.fit(rech, w*0.2))
		s.color(colInk)
		// boxes: spent ones filled; too many → numbers
		bx := x + 2.4 + nameW + w*0.21
		avail := x + w - 2.4 - bx
		const cb, cg = 2.6, 0.9
		if r.Max > 0 && float64(r.Max)*(cb+cg) <= avail {
			spent := int(r.Max - r.Left)
			for i := 0; i < int(r.Max); i++ {
				s.checkbox(bx+float64(i)*(cb+cg), ry-2.3, cb, i < spent)
			}
		} else {
			s.font(fUI, "B", 7.4)
			s.text(bx, ry, fmt.Sprintf("%d / %d", r.Left, r.Max))
		}
		ry += rowH
	}
	return y + h
}

// conditionsBox: what is on the character now + a free area (the box reaches the bottom).
func (s *sheetPDF) conditionsBox(x, y, w, h float64) {
	m := s.m
	top := s.box(x, y, w, h, "Conditions & active effects")
	s.font(fUI, "", 7.2)
	lh := lineH(7.2)
	ty := top + lh - 0.6
	if len(m.Conditions) == 0 {
		s.font(fUI, "I", 7)
		s.color(colMuted)
		s.text(x+2.4, ty, "None at the moment of printing.")
		s.color(colInk)
		ty += lh
	} else {
		for _, l := range s.wrap(strings.Join(m.Conditions, " · "), w-4.8) {
			if ty > y+h-2 {
				break
			}
			s.text(x+2.4, ty, l)
			ty += lh
		}
	}
	// ruled lines to write on
	for ly := ty + 3; ly < y+h-3; ly += 6 {
		s.hline(x+2.4, x+w-2.4, ly, colBorder, 0.12)
	}
}

// ---------- flowing text (pages 2 and 3) ----------

// flow lays blocks out in two columns, adding pages as needed.
type flow struct {
	s     *sheetPDF
	title string // running header title on new pages
	cols  int
	colW  float64
	gap   float64
	top   float64
	col   int
	y     float64
}

func (s *sheetPDF) newFlow(title string, top float64) *flow {
	gap := 6.0
	return &flow{s: s, title: title, cols: 2, gap: gap, colW: (contW - gap) / 2, top: top, y: top}
}

func (fl *flow) x() float64 { return pgM + float64(fl.col)*(fl.colW+fl.gap) }

// need: makes room for h mm (next column / next page).
func (fl *flow) need(h float64) {
	if fl.y+h <= pgBot {
		return
	}
	fl.next()
}

func (fl *flow) next() {
	fl.col++
	if fl.col >= fl.cols {
		fl.s.f.AddPage()
		fl.top = fl.s.runningHeader(fl.title + " (continued)")
		fl.col = 0
	}
	fl.y = fl.top
}

// section: a titled band (the title keeps at least `keep` mm of content with it).
func (fl *flow) section(title string, keep float64) {
	s := fl.s
	if fl.y > fl.top+0.1 {
		fl.y += 2.5
	}
	fl.need(7 + keep)
	s.label(fl.x(), fl.y+3.6, title, fl.colW, 8.4)
	s.hline(fl.x(), fl.x()+fl.colW, fl.y+5, colAccent, 0.3)
	fl.y += 7.2
}

// subhead: a group title inside a section.
func (fl *flow) subhead(title string, keep float64) {
	s := fl.s
	fl.need(5 + keep)
	s.font(fUI, "B", 6.6)
	s.color(colMuted)
	s.text(fl.x(), fl.y+3, s.fit(strings.ToUpper(title), fl.colW))
	s.color(colInk)
	fl.y += 4.6
}

// item: a bold name, a right-aligned meta, a line of tags, then the description.
func (fl *flow) item(name, meta, tags, desc string) {
	s := fl.s
	const descSize = 8.4
	lh := lineH(descSize) * 0.98
	s.font(fText, "", descSize)
	lines := s.wrap(desc, fl.colW)
	head := 4.4
	if tags != "" {
		head += 3.2
	}
	fl.need(head + math.Min(float64(len(lines)), 2)*lh)

	x := fl.x()
	s.font(fUI, "", 6)
	metaW := 0.0
	if meta != "" {
		metaW = s.width(meta) + 2
	}
	s.font(fText, "B", 9.6)
	s.color(colInk)
	s.text(x, fl.y+3.4, s.fit(name, fl.colW-metaW))
	if meta != "" {
		s.font(fUI, "", 6)
		s.color(colMuted)
		s.textR(x+fl.colW, fl.y+3.3, meta)
	}
	fl.y += 4.4
	if tags != "" {
		s.font(fUI, "I", 6.4)
		s.color(colAccent)
		s.text(x, fl.y+2.2, s.fit(tags, fl.colW))
		fl.y += 3.2
	}
	s.color(colInk)
	s.font(fText, "", descSize)
	for _, l := range lines {
		if fl.y+lh > pgBot {
			fl.next()
			s.font(fText, "", descSize)
			s.color(colInk)
		}
		if l != "" {
			s.text(fl.x(), fl.y+lh-0.9, l)
		}
		fl.y += lh
	}
	fl.y += 1.6
}

// pairs: "Label: value" lines (personality, appearance).
func (fl *flow) pair(label, value string) {
	s := fl.s
	const size = 8.6
	lh := lineH(size)
	s.font(fUI, "B", 6.6)
	lab := strings.ToUpper(label)
	s.font(fText, "", size)
	if strings.TrimSpace(value) == "" {
		value = "—"
	}
	lines := s.wrap(value, fl.colW)
	fl.need(3.4 + lh)
	s.font(fUI, "B", 6.2)
	s.color(colMuted)
	s.text(fl.x(), fl.y+2.6, s.fit(lab, fl.colW))
	fl.y += 3.4
	s.color(colInk)
	s.font(fText, "", size)
	for _, l := range lines {
		if fl.y+lh > pgBot {
			fl.next()
			s.font(fText, "", size)
		}
		s.text(fl.x(), fl.y+lh-0.9, l)
		fl.y += lh
	}
	fl.y += 1.2
}

// ---------- page 2 ----------

func (s *sheetPDF) page2() {
	m := s.m
	s.f.AddPage()
	top := s.runningHeader("Features, actions & equipment")
	fl := s.newFlow("Features, actions & equipment", top)

	if len(m.Features) > 0 {
		fl.section("Features & traits", 14)
		for _, g := range m.Features {
			fl.subhead(g.Title, 10)
			for _, it := range g.Items {
				fl.item(it.Name, it.Meta, "", it.Desc)
			}
		}
	}

	if len(m.Actions) > 0 {
		fl.section("Actions", 14)
		for _, g := range m.Actions {
			fl.subhead(g.Title, 10)
			for _, it := range g.Items {
				fl.item(it.Name, it.Source, joinDot(it.Tags, it.Note), it.Desc)
			}
		}
	}

	fl.section("Equipment", 8)
	if len(m.Equipment) == 0 {
		s.font(fUI, "I", 7.4)
		s.color(colMuted)
		s.text(fl.x(), fl.y+3, "Empty")
		s.color(colInk)
		fl.y += 5
	}
	for _, e := range m.Equipment {
		const rh = 4.4
		fl.need(rh)
		x := fl.x()
		s.font(fUI, "", 6.4)
		tag := ""
		if e.Tag != "" {
			tag = e.Tag
		}
		qty := fmt.Sprintf("× %d", max(e.Qty, 1))
		s.font(fUI, "B", 7.2)
		qw := s.width(qty)
		s.font(fUI, "I", 6.2)
		tw := 0.0
		if tag != "" {
			tw = s.width(tag) + 2
		}
		s.font(fText, "", 9)
		s.color(colInk)
		s.text(x, fl.y+3.2, s.fit(e.Name, fl.colW-qw-tw-3))
		if tag != "" {
			s.font(fUI, "I", 6.2)
			s.color(colAccent)
			s.textR(x+fl.colW-qw-2, fl.y+3.1, tag)
		}
		s.font(fUI, "B", 7.2)
		s.color(colInk)
		s.textR(x+fl.colW, fl.y+3.1, qty)
		s.hline(x, x+fl.colW, fl.y+4.3, colBorder, 0.12)
		fl.y += rh
	}

	fl.section("Personality", 10)
	fl.pair("Alignment", m.Alignment)
	for _, g := range m.Bio {
		if g.Title == "Personality" {
			for _, fd := range g.Fields {
				fl.pair(fd.Label, fd.Value)
			}
		}
	}
	for _, g := range m.Bio {
		if g.Title == "Personality" {
			continue
		}
		fl.section(g.Title, 10)
		// short values side by side: "Age 31 · Height 5'9" · …"
		var parts []string
		for _, fd := range g.Fields {
			if strings.TrimSpace(fd.Value) != "" && fd.Value != "—" {
				parts = append(parts, fd.Label+": "+fd.Value)
			}
		}
		if len(parts) == 0 {
			parts = []string{"—"}
		}
		s.font(fText, "", 8.8)
		lh := lineH(8.8)
		for _, l := range s.wrap(strings.Join(parts, "  ·  "), fl.colW) {
			fl.need(lh)
			s.font(fText, "", 8.8)
			s.color(colInk)
			s.text(fl.x(), fl.y+lh-0.9, l)
			fl.y += lh
		}
	}

	// notes: empty ones only get ruled lines if there's room left (no page just for them)
	if strings.TrimSpace(m.Notes) == "" && fl.y+2.5+7.2+20 > pgBot && fl.col == fl.cols-1 {
		return
	}
	fl.section("Notes", 12)
	if strings.TrimSpace(m.Notes) != "" {
		s.font(fText, "", 8.8)
		lh := lineH(8.8)
		for _, l := range s.wrap(m.Notes, fl.colW) {
			fl.need(lh)
			s.font(fText, "", 8.8)
			s.color(colInk)
			if l != "" {
				s.text(fl.x(), fl.y+lh-0.9, l)
			}
			fl.y += lh
		}
	}
	// ruled lines to the bottom of the column
	for ly := fl.y + 5; ly < pgBot-1; ly += 6.5 {
		s.hline(fl.x(), fl.x()+fl.colW, ly, colBorder, 0.12)
	}
}

func joinDot(xs ...string) string { return strings.Join(nonEmpty(xs...), " · ") }

// ---------- page 3 ----------

func (s *sheetPDF) page3() {
	m := s.m
	s.f.AddPage()
	y := s.runningHeader("Spellcasting")

	// ability / DC / attack — one row per source (class, species)
	for _, c := range m.Casting {
		const h = 15.0
		gap := 2.2
		titleW := 52.0
		w := (contW - titleW - 3*gap) / 3
		s.box(pgM, y, titleW, h, "")
		s.label(pgM+2.4, y+4, "Spellcasting", titleW-4.8, 6)
		s.font(fText, "B", 11)
		s.color(colInk)
		s.text(pgM+2.4, y+10.6, s.fit(c.Title, titleW-4.8))
		x := pgM + titleW + gap
		dc := "—"
		if c.DC != nil {
			dc = fmt.Sprint(*c.DC)
		}
		atk := c.Attack
		if atk == "" {
			atk = "—"
		}
		for _, cell := range []struct{ label, value string }{
			{"Spellcasting ability", c.Ability}, {"Spell save DC", dc}, {"Spell attack bonus", atk},
		} {
			s.box(x, y, w, h, "")
			s.labelC(x+w/2, y+4, cell.label, w-3, 5.8)
			size := 13.0
			s.font(fUI, "B", size)
			for size > 8 && s.width(cell.value) > w-3 {
				size -= 0.5
				s.font(fUI, "B", size)
			}
			s.color(colInk)
			s.textC(x+w/2, y+11.4, cell.value)
			x += w + gap
		}
		y += h + 2.5
	}

	// spell slots: a column per level, spent ones filled
	if len(m.Slots) > 0 {
		const h = 17.0
		top := s.box(pgM, y, contW, h, "Spell slots")
		n := len(m.Slots)
		cw := (contW - 4.8) / float64(max(n, 9))
		for i, sl := range m.Slots {
			cx := pgM + 2.4 + cw*float64(i)
			name := ordinal(int(sl.Level))
			if sl.Pact {
				name = "Pact · " + name
			}
			s.font(fUI, "B", 6.6)
			s.color(colInk)
			s.text(cx, top+3, s.fit(name, cw-1))
			const cb, cg = 2.6, 0.8
			perRow := int((cw - 1) / (cb + cg))
			if perRow < 1 {
				perRow = 1
			}
			for k := 0; k < int(sl.Max); k++ {
				row, col := k/perRow, k%perRow
				s.checkbox(cx+float64(col)*(cb+cg), top+4.6+float64(row)*(cb+cg), cb, k < int(sl.Used))
			}
		}
		y += h + 2.5
	}

	if len(m.Spells) == 0 {
		return
	}
	fl := s.newFlow("Spellcasting", y+1)
	for _, g := range m.Spells {
		fl.section(g.Title, 12)
		for _, it := range g.Items {
			meta := it.Source
			if meta == g.Title {
				meta = "" // "Level 1" under the "Level 1" title
			}
			fl.item(it.Name, strings.TrimPrefix(meta, g.Title+" · "), joinDot(it.Tags, it.Note), it.Desc)
		}
	}
}

func ordinal(n int) string {
	switch n {
	case 1:
		return "1st"
	case 2:
		return "2nd"
	case 3:
		return "3rd"
	default:
		return fmt.Sprintf("%dth", n)
	}
}
